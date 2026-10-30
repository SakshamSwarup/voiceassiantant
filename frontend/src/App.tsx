import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  SiFastapi,
  SiPython,
  SiReact,
  SiTailwindcss,
  SiTypescript,
  SiVite,
  SiWebrtc,
} from "react-icons/si";
import LightRays from "./components/LightRays";
import LogoLoop from "./components/LogoLoop";
import type { LogoItem } from "./components/LogoLoop";
import VoiceAssistant from "./VoiceAssistant";

const techLogos: LogoItem[] = [
  {
    node: <SiReact aria-hidden="true" />,
    title: "React",
    hoverColor: "#61DAFB",
  },
  {
    node: <SiTypescript aria-hidden="true" />,
    title: "TypeScript",
    hoverColor: "#3178C6",
  },
  { node: <SiVite aria-hidden="true" />, title: "Vite", hoverColor: "#646CFF" },
  {
    node: <SiTailwindcss aria-hidden="true" />,
    title: "Tailwind CSS",
    hoverColor: "#06B6D4",
  },
  {
    node: <SiPython aria-hidden="true" />,
    title: "Python",
    hoverColor: "#3776AB",
  },
  {
    node: <SiFastapi aria-hidden="true" />,
    title: "FastAPI",
    hoverColor: "#009688",
  },
  {
    node: <span className="tech-wordmark">OpenAI</span>,
    ariaLabel: "OpenAI",
    hoverColor: "#FFFFFF",
  },
  {
    node: <SiWebrtc className="tech-webrtc" aria-hidden="true" />,
    title: "WebRTC",
    hoverColor: "#333333",
  },
];

function App() {
  const [started, setStarted] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {started ? (
        <motion.div
          key="assistant"
          initial={{ opacity: reducedMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.3 }}
          onAnimationComplete={() => {
            document
              .querySelector<HTMLButtonElement>(".microphone-button")
              ?.focus({ preventScroll: true });
          }}
        >
          <VoiceAssistant />
        </motion.div>
      ) : (
        <motion.main
          key="landing"
          className="landing-page"
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.35 }}
        >
          <div className="landing-rays" aria-hidden="true">
            {!reducedMotion && (
              <LightRays
                raysOrigin="top-center"
                raysColor="#c5dbff"
                raysSpeed={0.7}
                rayLength={3}
                rayDensity={1.4}
                raySharpness={0.6}
                glow={0.7}
                haze={0.3}
                atmosphere={0.8}
                intensity={0.8}
                followMouse
                mouseInfluence={0.12}
                cursorShadow
                clickPulse
                intro
              />
            )}
          </div>
          <div className="landing-border" aria-hidden="true" />
          <div className="landing-content">
            <h1>Welcome to Advanced Voice Assistant</h1>
            <button
              type="button"
              className="landing-start"
              onClick={() => setStarted(true)}
            >
              Get Started <span aria-hidden="true">→</span>
            </button>
            <div className="landing-tech-panel">
              <LogoLoop
                logos={techLogos}
                speed={75}
                direction="left"
                logoHeight={32}
                gap={52}
                hoverSpeed={0}
                scaleOnHover
                labels="inline"
                fadeOut
                fadeOutWidth={0.08}
                intro
                ariaLabel="Technologies powering this voice assistant"
                style={{
                  "--logoloop-logoHeight": "clamp(24px, 3vw, 32px)",
                  "--logoloop-gap": "clamp(28px, 4vw, 52px)",
                }}
              />
            </div>
          </div>
        </motion.main>
      )}
    </AnimatePresence>
  );
}

export default App;
