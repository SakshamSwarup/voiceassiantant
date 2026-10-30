import { useRef } from "react";
import type { MouseEventHandler } from "react";
import { Mic } from "lucide-react";
import type { MotionValue } from "motion/react";
import { Orb } from "./Orb";

type MicrophoneButtonProps = {
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  active?: boolean;
  isSpeaking?: boolean;
  volume?: MotionValue<number>;
  onPress?: MouseEventHandler<HTMLButtonElement>;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "aria-describedby"?: string;
  "aria-busy"?: boolean;
};

export function MicrophoneButton({
  size = "large",
  disabled = false,
  active = false,
  isSpeaking = false,
  volume,
  onPress,
  "aria-label": ariaLabel = "Voice assistant microphone",
  "aria-pressed": ariaPressed,
  "aria-describedby": ariaDescribedBy,
  "aria-busy": ariaBusy,
}: MicrophoneButtonProps) {
  const interaction = useRef({ x: 0, y: 0, hovering: false, pulseAt: -Infinity });
  return (
    <div
      onPointerMove={(event) => {
        if (disabled || event.pointerType === "touch") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        interaction.current.x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
        interaction.current.y = Math.max(-1, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height * 2));
        interaction.current.hovering = true;
      }}
      onPointerLeave={() => { interaction.current.hovering = false; }}
      onPointerCancel={() => { interaction.current.hovering = false; }}
      data-active={active || undefined}
      data-speaking={active && isSpeaking || undefined}
      className={`microphone-control microphone-control--${size} relative grid shrink-0 place-items-center`}
    >
      <Orb audioLevel={volume} isListening={active} interaction={interaction} />
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        aria-describedby={ariaDescribedBy}
        aria-busy={ariaBusy}
        disabled={disabled}
        onClick={(event) => {
          interaction.current.pulseAt = performance.now();
          onPress?.(event);
        }}
        className="microphone-button orb-microphone-button relative z-10 grid place-items-center rounded-full text-[#F4F5FF] focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Mic aria-hidden="true" className="microphone-icon" strokeWidth={1.6} />
      </button>
    </div>
  );
}
