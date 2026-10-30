// Standard USD rates verified against https://developers.openai.com/api/docs/pricing
// and /models/gpt-6-luna on 2026-10-30. These are estimates, not invoices.
export const DEFAULT_VOICE_RATES = {
  voicePerMinute: 0.05,
  inputPerMillion: 0.10,
  cachedPerMillion: 0.01,
  cacheWritePerMillion: 0.125,
  outputPerMillion: 0.50,
  longContextThreshold: 272_000,
  longInputMultiplier: 2,
  longOutputMultiplier: 1.5,
};
export type VoiceRates = typeof DEFAULT_VOICE_RATES;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function voiceCostOptions(env: Record<string, unknown>) {
  const numeric = (key: string, fallback: number, minimum = 0) => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < minimum) {
      throw new Error(`${key} must be a number greater than or equal to ${minimum}.`);
    }
    return value;
  };
  return {
    idleSeconds: numeric("VITE_VOICE_IDLE_TIMEOUT_SECONDS", 60, 20),
    rates: {
      ...DEFAULT_VOICE_RATES,
      voicePerMinute: numeric("VITE_VOICE_USD_PER_MINUTE", DEFAULT_VOICE_RATES.voicePerMinute),
      inputPerMillion: numeric("VITE_RESPONSES_INPUT_USD_PER_MILLION", DEFAULT_VOICE_RATES.inputPerMillion),
      cachedPerMillion: numeric("VITE_RESPONSES_CACHED_USD_PER_MILLION", DEFAULT_VOICE_RATES.cachedPerMillion),
      cacheWritePerMillion: numeric("VITE_RESPONSES_CACHE_WRITE_USD_PER_MILLION", DEFAULT_VOICE_RATES.cacheWritePerMillion),
      outputPerMillion: numeric("VITE_RESPONSES_OUTPUT_USD_PER_MILLION", DEFAULT_VOICE_RATES.outputPerMillion),
    },
  };
}

type ResponseUsage = {
  id: string;
  model: string | null;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  estimatedUsd: number | null;
};

export function createVoiceUsage(rates: VoiceRates) {
  let seconds: number | null = null;
  let final = false;
  const responses = new Map<string, ResponseUsage>();
  const expectedResponses = new Set<string>();
  const tools = new Map<string, string>();
  const active = new Set<string>();
  const terminal = new Set<string>();
  let uncorrelatedWork = false;
  const missing = new Set<string>();

  const recordResponse = (response: Record<string, unknown>, status: string) => {
    if (typeof response.id !== "string") {
      missing.add("Response ID missing; usage cannot be deduplicated.");
      return;
    }
    if (responses.has(response.id)) return;
    const usage = isRecord(response.usage) ? response.usage : {};
    const details = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
    const inputTokens = count(usage.input_tokens);
    const outputTokens = count(usage.output_tokens);
    const cachedTokens = count(details.cached_tokens);
    const cacheWriteTokens = count(details.cache_write_tokens);
    const model = typeof response.model === "string" ? response.model : null;
    let estimatedUsd: number | null = null;
    if (inputTokens !== null && outputTokens !== null && cachedTokens !== null &&
      cacheWriteTokens !== null && cachedTokens + cacheWriteTokens <= inputTokens &&
      model === "gpt-6-luna" &&
      (response.service_tier === "default" || response.service_tier === undefined)) {
      const long = inputTokens > rates.longContextThreshold;
      estimatedUsd = (
        ((inputTokens - cachedTokens - cacheWriteTokens) * rates.inputPerMillion +
          cachedTokens * rates.cachedPerMillion + cacheWriteTokens * rates.cacheWritePerMillion) *
          (long ? rates.longInputMultiplier : 1) +
        outputTokens * rates.outputPerMillion * (long ? rates.longOutputMultiplier : 1)
      ) / 1_000_000;
      if (cacheWriteTokens > 0) missing.add("Cache-write estimate assumes the configured cache-write rate/TTL.");
    } else {
      missing.add("Some response usage, model, or pricing-tier details are unavailable or unsupported.");
    }
    responses.set(response.id, {
      id: response.id, model, status, inputTokens, outputTokens, cachedTokens, cacheWriteTokens, estimatedUsd,
    });
  };

  return {
    ingest(event: Record<string, unknown>) {
      if (event.type === "session.usage.updated" || event.type === "session.closed") {
        const reported = isRecord(event.usage) ? count(event.usage.seconds) : null;
        if (reported !== null && (!final || event.type === "session.closed")) seconds = reported;
        if (event.type === "session.closed") final = reported !== null;
      }
      if (event.type === "session.delegation.created") {
        if (isRecord(event.delegation) && typeof event.delegation.id === "string") {
          if (!terminal.has(event.delegation.id)) active.add(event.delegation.id);
          if (typeof event.delegation.response_id === "string") expectedResponses.add(event.delegation.response_id);
        } else {
          uncorrelatedWork = true;
        }
      }
      if (event.type !== "response.event" || !isRecord(event.event)) return;
      const nested = event.event;
      const response = isRecord(nested.response) ? nested.response : null;
      const key = typeof event.delegation_id === "string" ? event.delegation_id
        : response && typeof response.id === "string" ? response.id : null;
      if (response && typeof response.id === "string") expectedResponses.add(response.id);
      if (nested.type === "response.created" || nested.type === "response.in_progress") {
        if (key && !terminal.has(key)) active.add(key);
        else if (!key) uncorrelatedWork = true;
      }
      if (["response.completed", "response.failed", "response.incomplete"].includes(String(nested.type))) {
        if (key) { active.delete(key); terminal.add(key); }
        else uncorrelatedWork = true;
        if (response && typeof response.id === "string") {
          active.delete(response.id);
          terminal.add(response.id);
        }
        if (response) recordResponse(response, String(nested.type));
        else missing.add("Terminal response event did not contain usage.");
      }
      // Lifecycle snapshots omit output arrays. Count only granular tool items.
      if (nested.type === "response.output_item.done" && isRecord(nested.item) &&
        typeof nested.item.id === "string" && typeof nested.item.type === "string" &&
        nested.item.type !== "message" && nested.item.type !== "reasoning") {
        tools.set(nested.item.id, nested.item.type);
      }
    },
    get busy() { return active.size > 0 || uncorrelatedWork; },
    report(sessionId: string | null, reason: string) {
      const rows = [...responses.values()];
      const voiceUsd = seconds === null ? null : seconds / 60 * rates.voicePerMinute;
      const backendUsd = rows.every((r) => r.estimatedUsd !== null)
        ? rows.reduce((total, r) => total + (r.estimatedUsd ?? 0), 0) : null;
      const notes = [...missing];
      if (!final) notes.push("Final session.usage.seconds was not confirmed.");
      if ([...expectedResponses].some((id) => !responses.has(id)) || active.size || uncorrelatedWork) {
        notes.push("Delegated work has incomplete usage/finalization.");
      }
      if (tools.size) notes.push("Tool items observed; tool charges are not included.");
      return {
        sessionId, reason, final, seconds,
        responses: rows,
        toolItems: [...tools.values()].reduce<Record<string, number>>((totals, type) => {
          totals[type] = (totals[type] ?? 0) + 1;
          return totals;
        }, {}),
        voiceEstimatedUsd: voiceUsd,
        responsesEstimatedUsd: backendUsd,
        estimatedTotalUsd: notes.length === 0 && voiceUsd !== null && backendUsd !== null
          ? voiceUsd + backendUsd : null,
        notes,
        rates,
      };
    },
  };
}

export function createIdleDeadline(timeoutSeconds: number, startedAt: number) {
  let lastActive = startedAt;
  return {
    touch(now: number) { lastActive = now; },
    poll(now: number, busyOrUnknown: boolean) {
      if (busyOrUnknown) lastActive = now;
      const remaining = Math.max(0, Math.ceil(timeoutSeconds - (now - lastActive) / 1000));
      return { close: remaining === 0, warningSeconds: remaining <= 10 ? remaining : null };
    },
  };
}
