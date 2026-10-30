import type { ReactNode } from "react";

type VoiceAssistantLayoutProps = {
  children: ReactNode;
};

export function VoiceAssistantLayout({ children }: VoiceAssistantLayoutProps) {
  return (
    <main className="voice-assistant-layout grid min-h-svh w-full place-items-center px-5 py-8 sm:px-8">
      <h1 className="sr-only">Voice AI Assistant</h1>
      {children}
    </main>
  );
}
