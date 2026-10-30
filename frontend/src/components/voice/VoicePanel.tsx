import type { ReactNode } from "react";

type VoicePanelProps = {
  children: ReactNode;
};

export function VoicePanel({ children }: VoicePanelProps) {
  return (
    <section
      aria-label="Voice interaction"
      className="voice-panel relative isolate grid w-full max-w-[1160px] place-items-center"
    >
      {children}
    </section>
  );
}
