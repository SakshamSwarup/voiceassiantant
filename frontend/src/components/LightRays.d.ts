import type { ComponentType, CSSProperties } from "react";

type LightRaysProps = {
  raysOrigin?: "top-left" | "top-center" | "top-right" | "left" | "right" | "bottom-left" | "bottom-center" | "bottom-right";
  raysColor?: string;
  raysSpeed?: number;
  lightSpread?: number;
  rayLength?: number;
  rayDensity?: number;
  raySharpness?: number;
  glow?: number;
  haze?: number;
  atmosphere?: number;
  intensity?: number;
  followMouse?: boolean;
  mouseInfluence?: number;
  cursorShadow?: boolean;
  clickPulse?: boolean;
  intro?: boolean;
  className?: string;
  style?: CSSProperties;
};

declare const LightRays: ComponentType<LightRaysProps>;
export default LightRays;
