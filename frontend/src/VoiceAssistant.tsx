import { PhoneOff } from "lucide-react";
import { MicrophoneButton } from "./components/voice/MicrophoneButton";
import { VoiceAssistantLayout } from "./components/voice/VoiceAssistantLayout";
import { VoicePanel } from "./components/voice/VoicePanel";
import { useVoiceSession } from "./hooks/useVoiceSession";

function VoiceAssistant() {
  const {
    status, error, playbackBlocked, audioRef, start, stop,
    activity, idleWarning, notice, continueCall,
  } = useVoiceSession();
  const connecting = status === "requestingPermission" || status === "connecting";
  const active = status === "connected";
  const message =
    active
      ? activity.error ?? (activity.isSuspended
        ? "Audio feedback paused. Tap the page to resume."
        : activity.isSpeaking ? "Connected • Speaking" : "Connected • Listening")
      : connecting
        ? "Connecting..."
        : status === "disconnecting"
          ? "Ending call..."
        : status === "error"
          ? error
          : notice ?? "Ready to talk";

  return (
    <VoiceAssistantLayout>
      <VoicePanel>
        <div className="voice-orb-stage" data-connecting={connecting || undefined} data-in-call={active || undefined}>
          <MicrophoneButton
            active={active && activity.isListening}
            isSpeaking={activity.isSpeaking}
            volume={activity.audioLevel}
            onPress={active || connecting ? stop : start}
            disabled={status === "disconnecting"}
            aria-label={active ? "Stop voice session" : connecting ? "Cancel connection" : "Start voice session"}
            aria-pressed={active || connecting}
            aria-busy={connecting || status === "disconnecting"}
            aria-describedby="microphone-status"
          />
        </div>
        {idleWarning !== null && (
          <div className="absolute inset-x-4 top-4 text-center text-sm text-slate-300">
            <span>Idle call closes in {idleWarning}s. </span>
            <button type="button" onClick={continueCall} className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-cyan-200">
              Continue call
            </button>
          </div>
        )}
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          controls={playbackBlocked}
          aria-label="Assistant audio. Press play if automatic playback was blocked."
          className={playbackBlocked ? "absolute inset-x-4 top-4 mx-auto h-10 max-w-full" : "hidden"}
        />
        <div className="voice-call-controls">
          {connecting && <span className="voice-connection-loader" aria-hidden="true" />}
          {active && (
            <button type="button" className="voice-end-call" onClick={stop} aria-label="End Call" title="End Call">
              <PhoneOff aria-hidden="true" size={21} strokeWidth={1.8} />
            </button>
          )}
          <p
            id="microphone-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="m-0 text-center text-sm text-slate-400"
          >
            {playbackBlocked ? "Press play on the audio controls to hear the assistant." : message}
          </p>
        </div>
      </VoicePanel>
    </VoiceAssistantLayout>
  );
}

export default VoiceAssistant;
