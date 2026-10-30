import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";

type MicrophoneRingsProps = {
  active?: boolean;
  volume?: MotionValue<number>;
};

export function MicrophoneRings({ active = false, volume }: MicrophoneRingsProps) {
  const restingVolume = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const scale = useTransform(volume ?? restingVolume, (value) =>
    active && !reducedMotion ? 1 + value * 0.07 : 1,
  );
  const shadow = useTransform(volume ?? restingVolume, (value) =>
    active
      ? `0 0 30px rgb(101 85 238 / ${0.05 + Math.min(value, reducedMotion ? 0.35 : 1) * 0.18})`
      : "0 0 30px rgb(101 85 238 / 0)",
  );
  return (
    <motion.div
      style={{ scale, boxShadow: shadow }}
      aria-hidden="true"
      className="microphone-rings pointer-events-none absolute inset-0 grid place-items-center"
    >
      {["outer", "middle", "inner"].map((ring) => (
        <span
          key={ring}
          className={`microphone-ring microphone-ring--${ring} absolute rounded-full`}
        />
      ))}
    </motion.div>
  );
}
