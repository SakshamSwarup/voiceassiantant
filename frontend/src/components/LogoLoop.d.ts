import type { ComponentType, CSSProperties, ReactNode } from "react";

export type LogoItem = {
  node: ReactNode;
  title?: string;
  ariaLabel?: string;
  hoverColor?: string;
  href?: string;
};

type LogoLoopProps = {
  logos: LogoItem[];
  speed?: number;
  direction?: "left" | "right" | "up" | "down";
  logoHeight?: number;
  gap?: number;
  hoverSpeed?: number;
  scaleOnHover?: boolean;
  labels?: "none" | "inline" | "below" | "hover";
  fadeOut?: boolean;
  fadeOutWidth?: number;
  intro?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties & { [key: `--${string}`]: string | number };
};

declare const LogoLoop: ComponentType<LogoLoopProps>;
export default LogoLoop;
