import { useEffect, useState } from "react";
import { useMotionValue } from "motion/react";

type ActivityState = {
  stream: MediaStream | null;
  isSpeaking: boolean;
  isSuspended: boolean;
  error: string | null;
};

const NOISE_FLOOR = 0.008;
const SPEAKING_START = 0.018;
const SPEAKING_STOP = 0.011;

export function useVoiceActivity(stream: MediaStream | null) {
  // Motion values drive visuals without rendering React on every audio sample.
  const volume = useMotionValue(0);
  const [activity, setActivity] = useState<ActivityState>({
    stream: null,
    isSpeaking: false,
    isSuspended: false,
    error: null,
  });

  useEffect(() => {
    volume.set(0);
    if (!stream) return;

    let disposed = false;
    let failed = false;
    let frame: number | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let smoothedRms = 0;
    let speaking = false;
    let lastSample = 0;
    let resuming = false;

    const report = (error: string | null, suspended = false) => {
      if (!disposed) {
        setActivity({ stream, isSpeaking: speaking, isSuspended: suspended, error });
      }
    };

    const cancelSampling = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      lastSample = 0;
      smoothedRms = 0;
      speaking = false;
      volume.set(0);
    };

    const samples = new Uint8Array(1024);
    const sample = (now: number) => {
      frame = null;
      if (disposed || failed || !analyser || context?.state !== "running") return;
      const elapsed = lastSample ? now - lastSample : 1000 / 30;
      if (elapsed >= 1000 / 30) {
        lastSample = now;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) {
          const amplitude = (value - 128) / 128;
          sum += amplitude * amplitude;
        }
        const rms = Math.sqrt(sum / samples.length);
        const smoothingMs = rms > smoothedRms ? 65 : 180;
        smoothedRms += (rms - smoothedRms) * (1 - Math.exp(-elapsed / smoothingMs));
        const nextSpeaking = speaking
          ? smoothedRms > SPEAKING_STOP
          : smoothedRms >= SPEAKING_START;
        if (nextSpeaking !== speaking) {
          speaking = nextSpeaking;
          report(null);
        }
        const normalized = Math.min(1, Math.max(0, (smoothedRms - NOISE_FLOOR) / 0.18));
        volume.set(normalized);
      }
      frame = requestAnimationFrame(sample);
    };

    const onStateChange = () => {
      if (disposed || failed || !context) return;
      if (context.state === "running") {
        report(null);
        if (frame === null) frame = requestAnimationFrame(sample);
      } else {
        cancelSampling();
        report(
          context.state === "closed" ? "Voice feedback stopped. Restart the microphone to retry." : null,
          context.state !== "closed",
        );
      }
    };

    const resume = async () => {
      if (disposed || failed || !context || context.state === "closed" || resuming) return;
      if (context.state === "running") {
        onStateChange();
        return;
      }
      resuming = true;
      try {
        await context.resume();
        if (!disposed) onStateChange();
      } catch {
        report("Voice feedback is paused. Tap the page to retry audio analysis.", true);
      } finally {
        resuming = false;
      }
    };

    const onTrackEnded = () => {
      failed = true;
      cancelSampling();
      source?.disconnect();
      analyser?.disconnect();
      report("Microphone audio ended. Restart the microphone to restore voice feedback.");
      if (context && context.state !== "closed") {
        void context.close().catch(() => {
          report("Audio analysis could not close cleanly. Reload the page before retrying.");
        });
      }
    };

    const initialize = async () => {
      try {
        if (typeof window.AudioContext !== "function") {
          report("Voice feedback is not supported in this browser. Microphone capture is still available.");
          return;
        }
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = samples.length;
        source = context.createMediaStreamSource(stream);
        // Deliberately never connect to context.destination: no mic playback.
        source.connect(analyser);
        context.addEventListener("statechange", onStateChange);
        stream.getAudioTracks().forEach((track) => track.addEventListener("ended", onTrackEnded));
        stream.addEventListener("inactive", onTrackEnded);
        if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
          onTrackEnded();
          return;
        }
        onStateChange();
        await resume();
      } catch {
        onTrackEnded();
        report("Voice feedback could not start. Stop and restart the microphone to retry.");
      }
    };

    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    void initialize();

    return () => {
      disposed = true;
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      stream.removeEventListener("inactive", onTrackEnded);
      stream.getAudioTracks().forEach((track) => track.removeEventListener("ended", onTrackEnded));
      context?.removeEventListener("statechange", onStateChange);
      cancelSampling();
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") {
        void context.close().catch(() => {
          console.warn("Voice feedback AudioContext cleanup failed.");
        });
      }
    };
  }, [stream, volume]);

  const current = activity.stream === stream;
  return {
    volume,
    audioLevel: volume,
    isListening: stream !== null && stream.active,
    isAnalyzing: current && stream !== null && !activity.error && !activity.isSuspended,
    isSpeaking: current && activity.isSpeaking,
    isSuspended: current && activity.isSuspended,
    error: current ? activity.error : null,
  };
}
