import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdleDeadline, createVoiceUsage, DEFAULT_VOICE_RATES, voiceCostOptions,
} from "../src/lib/voiceUsage.ts";

const response = (id = "resp_1", usage = {
  input_tokens: 1000, output_tokens: 100,
  input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 },
}) => ({
  type: "response.event", delegation_id: "task_1",
  event: { type: "response.completed", response: { id, model: "gpt-6-luna", usage, service_tier: "default" } },
});

test("usage snapshots replace, final seconds win, initialization is not added twice", () => {
  const usage = createVoiceUsage(DEFAULT_VOICE_RATES);
  usage.ingest({ type: "session.usage.updated", usage: { seconds: 15 } });
  usage.ingest({ type: "session.usage.updated", usage: { seconds: 60 } });
  usage.ingest({ type: "session.closed", usage: { seconds: 90 } });
  usage.ingest({ type: "session.usage.updated", usage: { seconds: 80 } });
  const report = usage.report("live_test", "closed");
  assert.equal(report.seconds, 90);
  assert.equal(report.voiceEstimatedUsd, 0.07500000000000001);
  assert.equal(report.final, true);
});

test("Responses deduplicated by ID, cached tokens separated, no private text retained", () => {
  const usage = createVoiceUsage(DEFAULT_VOICE_RATES);
  usage.ingest({ type: "session.delegation.created", delegation: { id: "task_1", response_id: "resp_1" } });
  assert.equal(usage.busy, true);
  usage.ingest(response());
  usage.ingest(response());
  usage.ingest({ type: "session.input_transcript.delta", delta: "private statement" });
  usage.ingest({ type: "session.closed", usage: { seconds: 60 } });
  const report = usage.report("live_test", "closed");
  assert.equal(usage.busy, false);
  assert.equal(report.responses.length, 1);
  assert.ok(Math.abs(report.responsesEstimatedUsd - 0.000132) < 1e-12);
  assert.ok(Math.abs(report.estimatedTotalUsd - 0.050132) < 1e-12);
  assert.equal(JSON.stringify(report).includes("private statement"), false);
});

test("incomplete responses count usage once and release delegated task", () => {
  const usage = createVoiceUsage(DEFAULT_VOICE_RATES);
  usage.ingest({ type: "session.delegation.created", delegation: { id: "task_1" } });
  const event = response();
  event.event.type = "response.incomplete";
  usage.ingest(event);
  assert.equal(usage.busy, false);
  assert.equal(usage.report("live_test", "closed").responses[0].status, "response.incomplete");
});

test("missing metrics, model changes, tool charges and unconfirmed close are not false totals", () => {
  const usage = createVoiceUsage(DEFAULT_VOICE_RATES);
  usage.ingest(response("missing", { input_tokens: 10, output_tokens: 2 }));
  const otherModel = response("other");
  otherModel.event.response.model = "not-our-priced-model";
  usage.ingest(otherModel);
  usage.ingest({ type: "response.event", event: { type: "response.output_item.done", item: { id: "tool_1", type: "web_search_call", private: "secret" } } });
  const report = usage.report("live_test", "lost");
  assert.equal(report.estimatedTotalUsd, null);
  assert.equal(report.responsesEstimatedUsd, null);
  assert.deepEqual(report.toolItems, { web_search_call: 1 });
  assert.equal(JSON.stringify(report).includes("secret"), false);
  assert.ok(report.notes.length >= 2);
});

test("unknown delegated state prevents idle close; per-call memory is isolated", () => {
  const a = createVoiceUsage(DEFAULT_VOICE_RATES);
  const b = createVoiceUsage(DEFAULT_VOICE_RATES);
  a.ingest({ type: "session.delegation.created" });
  assert.equal(a.busy, true);
  assert.equal(b.busy, false);
  assert.equal(b.report("new_call", "closed").responses.length, 0);
});

test("long-context pricing uses documented multipliers", () => {
  const usage = createVoiceUsage(DEFAULT_VOICE_RATES);
  usage.ingest(response("long", {
    input_tokens: 300_000, output_tokens: 100,
    input_tokens_details: { cached_tokens: 100_000, cache_write_tokens: 0 },
  }));
  assert.ok(Math.abs(usage.report("live_test", "closed").responsesEstimatedUsd - 0.042075) < 1e-12);
});

test("cache-write tokens are tracked separately and flag TTL assumption", () => {
  const usage = createVoiceUsage(DEFAULT_VOICE_RATES);
  usage.ingest(response("write", {
    input_tokens: 1000, output_tokens: 100,
    input_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 },
  }));
  const report = usage.report("live_test", "closed");
  assert.equal(report.responses[0].cacheWriteTokens, 300);
  assert.ok(Math.abs(report.responsesEstimatedUsd - 0.0001395) < 1e-12);
  assert.equal(report.estimatedTotalUsd, null);
});

test("idle warning at 50s, close at 60s, continue resets without new session", () => {
  const idle = createIdleDeadline(60, 0);
  assert.equal(idle.poll(49_000, false).warningSeconds, null);
  assert.equal(idle.poll(50_000, false).warningSeconds, 10);
  idle.touch(55_000);
  assert.equal(idle.poll(60_000, false).warningSeconds, null);
  assert.equal(idle.poll(115_000, false).close, true);
});

test("speech, playback, delegation or unknown activity continuously postpones idle", () => {
  const idle = createIdleDeadline(60, 0);
  assert.equal(idle.poll(120_000, true).close, false);
  assert.equal(idle.poll(179_000, false).close, false);
  assert.equal(idle.poll(180_000, false).close, true);
});

test("configuration is explicit, configurable and validated", () => {
  assert.equal(voiceCostOptions({}).idleSeconds, 60);
  assert.equal(voiceCostOptions({ VITE_VOICE_IDLE_TIMEOUT_SECONDS: "90" }).idleSeconds, 90);
  assert.equal(voiceCostOptions({ VITE_VOICE_USD_PER_MINUTE: "0.06" }).rates.voicePerMinute, 0.06);
  assert.throws(() => voiceCostOptions({ VITE_VOICE_IDLE_TIMEOUT_SECONDS: "oops" }));
  assert.throws(() => voiceCostOptions({ VITE_VOICE_USD_PER_MINUTE: "-1" }));
});
