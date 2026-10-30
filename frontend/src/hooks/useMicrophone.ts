import { useCallback, useEffect, useRef, useState } from "react";

export type MicrophoneStatus = "idle" | "requesting" | "active" | "error";

type MicrophoneState = {
  status: MicrophoneStatus;
  stream: MediaStream | null;
  error: string | null;
};

export type UseMicrophoneResult = MicrophoneState & {
  startMicrophone: () => Promise<void>;
  stopMicrophone: () => void;
};

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Microphone access was denied. Allow microphone access in your browser's site settings, then try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No microphone was found. Connect a microphone, then try again.";
      case "NotReadableError":
      case "TrackStartError":
        return "Your microphone is unavailable. Close other apps using it and check your system microphone settings.";
      case "AbortError":
        return "Microphone access was interrupted. Please try again.";
      case "SecurityError":
        return "Microphone access is blocked by your browser or page permissions. Use localhost or HTTPS and check site settings.";
      case "OverconstrainedError":
        return "This microphone cannot provide audio. Try another microphone.";
    }
  }
  return "Unable to access your microphone. Check your device and browser permissions, then try again.";
}

export function useMicrophone(): UseMicrophoneResult {
  const [state, setState] = useState<MicrophoneState>({
    status: "idle",
    stream: null,
    error: null,
  });
  const mounted = useRef(false);
  const generation = useRef(0);
  const requesting = useRef(false);
  const currentStream = useRef<MediaStream | null>(null);
  const removeListeners = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    generation.current += 1;
    requesting.current = false;
    removeListeners.current?.();
    removeListeners.current = null;
    currentStream.current?.getTracks().forEach((track) => track.stop());
    currentStream.current = null;
  }, []);

  const stopMicrophone = useCallback(() => {
    release();
    if (mounted.current) {
      setState({ status: "idle", stream: null, error: null });
    }
  }, [release]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
    };
  }, [release]);

  const startMicrophone = useCallback(async () => {
    if (!mounted.current || requesting.current || currentStream.current) return;

    if (
      !window.isSecureContext ||
      typeof navigator.mediaDevices?.getUserMedia !== "function"
    ) {
      setState({
        status: "error",
        stream: null,
        error: !window.isSecureContext
          ? "Microphone access requires a secure page. Open this app on localhost or HTTPS."
          : "Microphone access is not supported in this browser. Try a current version of Chrome, Edge, Firefox, or Safari.",
      });
      return;
    }

    const requestGeneration = ++generation.current;
    requesting.current = true;
    setState({ status: "requesting", stream: null, error: null });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Permission prompts cannot be aborted; discard results from cancelled requests.
      if (!mounted.current || generation.current !== requestGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.some((track) => track.readyState === "live")) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("No live audio track", "NotFoundError");
      }

      const onEnded = () => {
        if (!mounted.current || generation.current !== requestGeneration) return;
        release();
        setState({
          status: "error",
          stream: null,
          error: "Your microphone disconnected or access was revoked. Check your device and try again.",
        });
      };

      currentStream.current = stream;
      audioTracks.forEach((track) => track.addEventListener("ended", onEnded));
      removeListeners.current = () => {
        audioTracks.forEach((track) => track.removeEventListener("ended", onEnded));
      };
      requesting.current = false;
      setState({ status: "active", stream, error: null });
    } catch (error: unknown) {
      if (!mounted.current || generation.current !== requestGeneration) return;
      release();
      setState({
        status: "error",
        stream: null,
        error: microphoneErrorMessage(error),
      });
    }
  }, [release]);

  return { ...state, startMicrophone, stopMicrophone };
}
