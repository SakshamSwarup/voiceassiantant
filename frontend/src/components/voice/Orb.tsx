import { useEffect, useRef, useState } from "react";
import type { MotionValue } from "motion/react";
import type { RefObject } from "react";

// Adapted from React Bits Orb by David Haz. See Orb.LICENSE.md.
// https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Backgrounds/Orb/Orb.tsx
const VERTEX = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uListening;
uniform float uReduced;
uniform vec2 uPointer;
uniform float uHover;
uniform float uPulse;
uniform float uRotation;
out vec4 outColor;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
}

float snoise3(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - K1);
  vec3 d3 = d0 - 0.5;
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
  return dot(vec4(31.316), n);
}

float light1(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * attenuation);
}
float light2(float intensity, float attenuation, float dist) {
  return intensity / (1.0 + dist * dist * attenuation);
}

void main() {
  float energy = uLevel * (1.0 - uReduced);
  float glow = 0.85 + uListening * 0.12 + uLevel * 1.1 + uHover * 0.15 + uPulse * 0.35;
  float wobble = 0.55 + energy * 2.6 + uHover * 0.35 + uPulse * 0.5;
  vec2 uv = (gl_FragCoord.xy - uResolution * 0.5) / min(uResolution.x, uResolution.y) * 2.0;
  uv /= 0.94 + energy * 0.035 + uPulse * 0.025;
  float len = length(uv);
  vec2 dir = len > 0.0001 ? uv / len : vec2(1.0, 0.0);
  float ang = atan(dir.y, dir.x);
  float n0 = snoise3(vec3(uv * 0.65, uTime * 0.5)) * 0.5 + 0.5;
  float pull = dot(dir, uPointer) * uHover * 0.025;
  float r0 = mix(0.8 - 0.04 * wobble, 0.8 + 0.04 * wobble, n0) + pull;
  float d0 = abs(len - r0);
  float v0 = light1(1.0, 10.0 / glow, d0);
  v0 *= 1.0 - smoothstep(r0, r0 * 1.05, len);
  float innerFade = smoothstep(r0 * 0.8, r0 * 0.95, len);
  v0 *= innerFade;
  float body = smoothstep(0.6, 0.8, len);
  float cl = cos(ang + uTime * 0.18 + uRotation) * 0.5 + 0.5;
  float pointerAngle = atan(uPointer.y, uPointer.x);
  float orbitAngle = uTime * 0.23 + uRotation;
  vec2 orbit = vec2(cos(orbitAngle), sin(orbitAngle));
  vec2 pointerLight = vec2(cos(pointerAngle), sin(pointerAngle));
  vec2 lightDirection = mix(orbit, pointerLight, uHover * 0.85);
  vec2 pos = lightDirection * r0;
  float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d) * (0.32 + energy * 0.3);
  v1 *= light1(1.0, 50.0, d0);
  float v2 = 1.0 - smoothstep(mix(0.6, 1.0, n0 * 0.5), 1.0, len);
  float band = v0 * v2 * body;
  float heat = pow(clamp(band / 0.82, 0.0, 1.0), 3.0);
  float bloom = light2(1.0, 160.0 / glow, max(len - r0, 0.0))
    * (1.0 - smoothstep(0.0, 0.4, len - r0)) * step(r0, len);
  vec3 base = mix(vec3(0.53, 0.26, 0.98), vec3(0.22, 0.76, 0.96), cl);
  vec3 col = mix(vec3(0.04, 0.06, 0.3), base, v0);
  col = (col + v1) * v2 * body * (1.0 + uListening * 0.08 + uLevel * 0.35)
    + mix(base, vec3(1.0), 0.25) * heat * 0.28;
  col = clamp(col + base * bloom * (0.1 + uLevel * 0.14 + uHover * 0.035 + uPulse * 0.18), 0.0, 1.0);
  float alpha = max(max(col.r, col.g), col.b);
  outColor = vec4(col * alpha, alpha);
}
`;

type OrbProps = {
  audioLevel?: MotionValue<number>;
  isListening: boolean;
  interaction: RefObject<{ x: number; y: number; hovering: boolean; pulseAt: number }>;
};

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const result = gl.createShader(type);
  if (!result) throw new Error("Unable to allocate Orb shader");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    gl.deleteShader(result);
    throw new Error("Unable to compile Orb shader");
  }
  return result;
}

export function Orb({ audioLevel, isListening, interaction }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const listening = useRef(isListening);
  useEffect(() => { listening.current = isListening; }, [isListening]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let gl: WebGL2RenderingContext | null = null;
    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let frame: number | null = null;
    let disposed = false;
    let lost = false;
    let time = 0;
    let last = 0;
    let pointerX = 0;
    let pointerY = 0;
    let hover = 0;
    let rotation = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      last = 0;
    };
    const fail = () => {
      lost = true;
      cancel();
      setUnavailable(true);
      console.warn("Orb WebGL rendering unavailable; using the accessible CSS fallback.");
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      fail();
    };

    let draw = () => {};
    let observer: ResizeObserver | null = null;
    let unsubscribe: (() => void) | undefined;
    const wake = () => {
      cancel();
      draw();
    };
    try {
      gl = canvas.getContext("webgl2", {
        alpha: true, premultipliedAlpha: true, antialias: false,
        depth: false, stencil: false,
      });
      if (!gl) throw new Error("WebGL2 unavailable");
      const context = gl;
      vertex = shader(context, context.VERTEX_SHADER, VERTEX);
      fragment = shader(context, context.FRAGMENT_SHADER, FRAGMENT);
      program = context.createProgram();
      if (!program) throw new Error("Unable to allocate Orb program");
      context.attachShader(program, vertex);
      context.attachShader(program, fragment);
      context.bindAttribLocation(program, 0, "aPosition");
      context.linkProgram(program);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) {
        throw new Error("Unable to link Orb program");
      }
      buffer = context.createBuffer();
      vao = context.createVertexArray();
      if (!buffer || !vao) throw new Error("Unable to allocate Orb geometry");
      context.bindVertexArray(vao);
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), context.STATIC_DRAW);
      context.enableVertexAttribArray(0);
      context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
      const linkedProgram = program;
      const uniforms = Object.fromEntries(
        ["uResolution", "uTime", "uLevel", "uListening", "uReduced", "uPointer", "uHover", "uPulse", "uRotation"].map((name) =>
          [name, context.getUniformLocation(linkedProgram, name)],
        ),
      );
      const geometry = vao;
      draw = (now = performance.now()) => {
        frame = null;
        if (disposed || lost || document.hidden) return;
        const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;
        const active = listening.current;
        const target = interaction.current;
        const ease = 1 - Math.exp(-dt * 9);
        pointerX += (target.x - pointerX) * ease;
        pointerY += (target.y - pointerY) * ease;
        hover += ((target.hovering ? 1 : 0) - hover) * ease;
        const age = Math.max(0, (now - target.pulseAt) / 1000);
        // One analytic damped pulse: repeated activations restart, never stack.
        const pulse = !reduced.matches && age < 1.2
          ? Math.exp(-age * 5) * Math.sin(age * 14) : 0;
        if (!reduced.matches) {
          time += dt * (active ? 0.7 : 0.25);
          rotation += dt * (hover * 0.15 + Math.max(0, pulse) * 2.2);
        }
        const rawLevel = audioLevel?.get() ?? 0;
        const level = active && Number.isFinite(rawLevel)
          ? Math.min(1, Math.max(0, rawLevel)) : 0;
        context.viewport(0, 0, canvas.width, canvas.height);
        context.useProgram(linkedProgram);
        context.bindVertexArray(geometry);
        context.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
        context.uniform1f(uniforms.uTime, reduced.matches ? 0 : time);
        context.uniform1f(uniforms.uLevel, reduced.matches ? Math.min(level, 0.3) : level);
        context.uniform1f(uniforms.uListening, active ? 1 : 0);
        context.uniform2f(uniforms.uPointer, pointerX, pointerY);
        context.uniform1f(uniforms.uHover, reduced.matches ? 0 : hover);
        context.uniform1f(uniforms.uPulse, pulse);
        context.uniform1f(uniforms.uRotation, reduced.matches ? 0 : rotation);
        context.uniform1f(uniforms.uReduced, reduced.matches ? 1 : 0);
        context.drawArrays(context.TRIANGLES, 0, 3);
        if (!reduced.matches) frame = requestAnimationFrame(draw);
      };
      observer = new ResizeObserver(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        wake();
      });
      observer.observe(canvas);
      // Reduced motion renders only on measured level changes, resize, or state changes.
      unsubscribe = audioLevel?.on("change", () => {
        if (reduced.matches) wake();
      });
      canvas.addEventListener("webglcontextlost", onLost);
      reduced.addEventListener("change", wake);
      document.addEventListener("visibilitychange", wake);
      wake();
    } catch {
      fail();
    }

    return () => {
      disposed = true;
      cancel();
      observer?.disconnect();
      unsubscribe?.();
      canvas.removeEventListener("webglcontextlost", onLost);
      reduced.removeEventListener("change", wake);
      document.removeEventListener("visibilitychange", wake);
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer);
        if (vao) gl.deleteVertexArray(vao);
        if (program) gl.deleteProgram(program);
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
        // Keep the canvas context reusable during React StrictMode effect replay.
      }
    };
  }, [audioLevel, interaction]);

  return (
    <span aria-hidden="true" className="voice-orb" data-fallback={unavailable || undefined}>
      <span className="voice-orb-fallback" />
      <canvas ref={canvasRef} className="voice-orb-canvas" />
      {unavailable && <span className="voice-orb-notice">Simplified visual</span>}
    </span>
  );
}
