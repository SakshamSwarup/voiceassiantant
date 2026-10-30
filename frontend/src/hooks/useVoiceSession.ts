import { useCallback, useEffect, useRef, useState } from "react";
import { useMicrophone } from "./useMicrophone";
import { useVoiceActivity } from "./useVoiceActivity";
import { createIdleDeadline, createVoiceUsage, isRecord, voiceCostOptions } from "../lib/voiceUsage";
import { API_URLS } from "../lib/api";

type SessionStatus = "idle" | "requestingPermission" | "connecting" | "connected" | "disconnecting" | "error";
type SessionState = { status: SessionStatus; error: string | null; sessionId: string | null };
type Connection = { stop: () => void; continueCall: () => void };

function waitForIce(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", check);
      signal.removeEventListener("abort", abort);
    };
    const check = () => {
      if (peer.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Connection cancelled", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Network setup timed out. Check your connection and retry."));
    }, 10_000);
    peer.addEventListener("icegatheringstatechange", check);
    signal.addEventListener("abort", abort);
    if (signal.aborted) abort();
    else check();
  });
}

export function useVoiceSession() {
  const microphone = useMicrophone();
  const { stream, stopMicrophone, startMicrophone } = microphone;
  const [state, setState] = useState<SessionState>({
    status: "idle", error: null, sessionId: null,
  });
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [idleWarning, setIdleWarning] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [costConfig] = useState(() => {
    try {
      return { options: voiceCostOptions(import.meta.env), error: null };
    } catch (error: unknown) {
      return { options: null, error: error instanceof Error ? error.message : "Invalid voice cost configuration." };
    }
  });
  const activity = useVoiceActivity(state.status === "disconnecting" ? null : stream);
  const analysisReady = useRef(false);
  useEffect(() => { analysisReady.current = activity.isAnalyzing; }, [activity.isAnalyzing]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const connection = useRef<Connection | null>(null);
  const starting = useRef(false);

  useEffect(() => {
    if (!stream || !costConfig.options) return;
    let disposed = false;
    let stopping = false;
    let ready = false;
    let peer: RTCPeerConnection | null = null;
    let events: RTCDataChannel | null = null;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    let disconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let idleInterval: ReturnType<typeof setInterval> | undefined;
    let idleClosed = false;
    const controller = new AbortController();
    const audio = audioRef.current;
    const remote = new MediaStream();
    let sessionId: string | null = null;
    const options = costConfig.options;
    const usage = createVoiceUsage(options.rates);
    const idle = createIdleDeadline(options.idleSeconds, Date.now());
    const unsubscribeVolume = activity.audioLevel.on("change", (level) => {
      if (level > 0) idle.touch(Date.now());
    });
    const onVisibilityChange = () => {
      idle.touch(Date.now());
      setIdleWarning(null);
    };
    const onPageHide = () => {
      if (ready && events?.readyState === "open" && !stopping) {
        try { events.send(JSON.stringify({ type: "session.close" })); }
        catch { console.warn("Voice close could not be sent while leaving the page."); }
      }
      finish("Call ended on navigation. Start a new call to continue; final usage is unconfirmed.");
    };

    const release = (reason = "cleanup") => {
      if (disposed) return;
      disposed = true;
      clearTimeout(startupTimeout);
      clearTimeout(closeTimeout);
      clearTimeout(disconnectTimeout);
      clearInterval(idleInterval);
      unsubscribeVolume();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controller.abort();
      console.info("[voice-usage] call", usage.report(sessionId, reason));
      if (events) {
        events.onmessage = null;
        events.onclose = null;
        events.onerror = null;
        events.close();
      }
      if (peer) {
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.close();
      }
      remote.getTracks().forEach((track) => track.stop());
      if (audio) {
        audio.pause();
        audio.srcObject = null;
      }
      if (connection.current === handle) connection.current = null;
    };
    const finish = (error: string | null) => {
      if (disposed) return;
      release(error ? "error" : idleClosed ? "idle_timeout" : "closed");
      starting.current = false;
      stopMicrophone();
      setPlaybackBlocked(false);
      setIdleWarning(null);
      setNotice(!error && idleClosed
        ? "Call ended after inactivity. Start a new call; previous in-call memory is not resumed."
        : null);
      setState({ status: error ? "error" : "idle", error, sessionId: null });
    };
    const fail = (message: string) => finish(message);
    const startupTimeout = setTimeout(() => {
      fail("Voice connection timed out. Check the backend and your network, then retry.");
    }, 45_000);
    const handle: Connection = {
      continueCall: () => {
        idle.touch(Date.now());
        setIdleWarning(null);
      },
      stop: () => {
        if (disposed || stopping) return;
        stopping = true;
        setState({ status: "disconnecting", error: null, sessionId });
        setPlaybackBlocked(false);
        clearTimeout(startupTimeout);
        clearInterval(idleInterval);
        setIdleWarning(null);
        controller.abort();
        audio?.pause();
        // Release capture immediately; retain the channel only for final closure/usage.
        stream.getTracks().forEach((track) => track.stop());
        if (ready && events?.readyState === "open") {
          closeTimeout = setTimeout(() => {
            fail("Connection stopped, but the server did not confirm session closure. Final usage is unconfirmed.");
          }, 15_000);
          try {
            events.send(JSON.stringify({ type: "session.close" }));
          } catch {
            fail("Connection stopped before session closure was confirmed. Final usage is unconfirmed.");
          }
        } else {
          finish(null);
        }
      },
    };
    connection.current = handle;
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    let checkingIdle = false;
    let statsWarningReported = false;
    const previousAudio = new Map<string, { energy: number; duration: number }>();
    const checkIdle = async () => {
      if (!ready || disposed || stopping || checkingIdle || !peer) return;
      checkingIdle = true;
      let remoteKnown = false;
      let remoteSpeaking = false;
      try {
        const stats = await peer.getStats();
        stats.forEach((stat) => {
          if (stat.type !== "inbound-rtp" || (stat.kind ?? stat.mediaType) !== "audio") return;
          if (typeof stat.totalAudioEnergy !== "number" || typeof stat.totalSamplesDuration !== "number") return;
          const previous = previousAudio.get(stat.id);
          const energy = stat.totalAudioEnergy;
          const duration = stat.totalSamplesDuration;
          previousAudio.set(stat.id, { energy, duration });
          if (previous && duration > previous.duration && energy >= previous.energy) {
            remoteKnown = true;
            remoteSpeaking ||= Math.sqrt((energy - previous.energy) / (duration - previous.duration)) > 0.001;
          }
        });
        if (disposed || stopping) return;
        if (!remoteKnown && previousAudio.size === 0 && !statsWarningReported) {
          console.info("Voice idle timeout waits for usable received-audio activity statistics; it will not guess silence.");
          statsWarningReported = true;
        }
        const busy = !analysisReady.current || !remoteKnown || remoteSpeaking ||
          usage.busy || activity.audioLevel.get() > 0 || document.hidden ||
          !audio || audio.paused || audio.ended || peer.connectionState !== "connected";
        const deadline = idle.poll(Date.now(), busy);
        setIdleWarning(deadline.warningSeconds);
        if (deadline.close) {
          idleClosed = true;
          handle.stop();
        }
      } catch {
        if (disposed || stopping) return;
        idle.touch(Date.now());
        setIdleWarning(null);
        if (!statsWarningReported) {
          console.warn("Voice idle timeout suspended: received-audio activity statistics unavailable.");
          statsWarningReported = true;
        }
      } finally {
        checkingIdle = false;
      }
    };

    const play = async () => {
      if (!audio || disposed || stopping) return;
      try {
        await audio.play();
        if (!disposed) setPlaybackBlocked(false);
      } catch {
        if (!disposed && !stopping) setPlaybackBlocked(true);
      }
    };

    const markConnected = () => {
      if (disposed || stopping || !ready || peer?.connectionState !== "connected") return;
      clearTimeout(startupTimeout);
      idle.touch(Date.now());
      idleInterval ??= setInterval(() => { void checkIdle(); }, 1000);
      setState({ status: "connected", error: null, sessionId });
    };

    const connect = async () => {
      try {
        if (typeof RTCPeerConnection !== "function") {
          throw new Error("WebRTC is not supported in this browser. Try a current browser.");
        }
        if (!audio) throw new Error("Assistant audio playback could not initialize. Reload the page.");
        const pc = new RTCPeerConnection();
        peer = pc;
        pc.ontrack = ({ track }) => {
          if (disposed || stopping) return;
          remote.addTrack(track);
          audio.srcObject = remote;
          void play();
        };
        pc.onconnectionstatechange = () => {
          if (disposed || stopping) return;
          if (pc.connectionState === "connected") markConnected();
          if (pc.connectionState === "disconnected") {
            setState({ status: "connecting", error: null, sessionId });
            disconnectTimeout ??= setTimeout(() => {
              fail("Voice connection did not recover. Check your network and reconnect.");
            }, 10_000);
          } else {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = undefined;
          }
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            fail("Voice connection was lost. Start a new conversation to reconnect.");
          }
        };
        stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
        const channel = pc.createDataChannel("oai-events");
        events = channel;
        channel.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (disposed || typeof data !== "string") return;
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            fail("The voice service sent an invalid session event. Please retry.");
            return;
          }
          if (!isRecord(event)) {
            fail("The voice service sent an invalid session event. Please retry.");
            return;
          }
          usage.ingest(event);
          if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta" ||
            event.type === "session.delegation.created") idle.touch(Date.now());
          if (event.type === "session.started" && !stopping) {
            ready = true;
            if (isRecord(event.session) && typeof event.session.id === "string") sessionId = event.session.id;
            markConnected();
          } else if (event.type === "session.closed") {
            finish(null);
          } else if (event.type === "error" || event.type === "session.error") {
            fail("The voice service reported a session error. Stop and retry; check backend configuration if it persists.");
          }
        };
        channel.onclose = () => {
          if (!disposed) fail("Voice connection closed without session confirmation. Final usage is unconfirmed.");
        };
        channel.onerror = () => {
          if (!disposed) fail("Voice session communication failed. Please reconnect.");
        };
        const offer = await pc.createOffer();
        if (disposed || stopping) return;
        await pc.setLocalDescription(offer);
        await waitForIce(pc, controller.signal);
        if (disposed || stopping) return;
        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error("The browser could not create an audio offer. Please retry.");
        const response = await fetch(API_URLS.voiceSession, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const messages: Record<number, string> = {
            404: "Voice endpoint not found. Check the configured backend URL and its app.main:app deployment.",
            422: "The backend rejected the browser audio offer. Check frontend/backend compatibility.",
            502: "The backend could not establish the upstream voice session. Check backend logs.",
            503: "Voice service is unavailable. Check the backend API key, personal-story file, model access, or capacity.",
            504: "The upstream voice service timed out. Please retry.",
          };
          throw new Error(messages[response.status] ?? `Voice session request failed (HTTP ${response.status}). Please retry.`);
        }
        const result: unknown = await response.json();
        if (
          !isRecord(result) || !isRecord(result.session) ||
          typeof result.session.id !== "string" || !result.session.id ||
          !isRecord(result.transport) || result.transport.type !== "webrtc" ||
          typeof result.transport.sdp !== "string" || !result.transport.sdp.trim()
        ) {
          throw new Error("The backend returned an invalid voice session response.");
        }
        if (disposed || stopping) return;
        sessionId = result.session.id;
        await pc.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
        // HTTP creation starts GPT-Live; never send session.start on the channel.
      } catch (error: unknown) {
        if (disposed || stopping) return;
        fail(error instanceof TypeError
          ? "Cannot connect to the voice backend. Check the configured backend URL, CORS, and your network."
          : error instanceof Error ? error.message : "Voice connection failed. Please retry.");
      }
    };
    void connect();
    return () => {
      if (!disposed) {
        if (ready && !stopping && events?.readyState === "open") {
          try {
            events.send(JSON.stringify({ type: "session.close" }));
            console.warn("Voice session released during cleanup without waiting for final usage confirmation.");
          } catch {
            console.warn("Voice session close could not be sent during cleanup.");
          }
        }
        release();
      }
    };
  }, [stream, stopMicrophone, activity.audioLevel, costConfig]);

  const start = useCallback(async () => {
    if (starting.current || connection.current) return;
    if (!costConfig.options) {
      setState({ status: "error", error: costConfig.error, sessionId: null });
      return;
    }
    starting.current = true;
    setState({ status: "requestingPermission", error: null, sessionId: null });
    setPlaybackBlocked(false);
    setNotice(null);
    setIdleWarning(null);
    try {
      await startMicrophone();
    } finally {
      starting.current = false;
    }
  }, [startMicrophone, costConfig]);

  const stop = useCallback(() => {
    if (connection.current) connection.current.stop();
    else {
      stopMicrophone();
      setState({ status: "idle", error: null, sessionId: null });
    }
  }, [stopMicrophone]);

  const continueCall = useCallback(() => connection.current?.continueCall(), []);
  const status: SessionStatus = microphone.status === "error" ? "error"
    : state.status === "requestingPermission" && stream ? "connecting" : state.status;
  return {
    status,
    stream: status === "disconnecting" ? null : stream,
    error: microphone.error ?? state.error,
    sessionId: state.sessionId,
    requestingPermission: microphone.status === "requesting",
    playbackBlocked,
    activity,
    idleWarning,
    notice,
    continueCall,
    audioRef,
    start,
    stop,
  };
}
