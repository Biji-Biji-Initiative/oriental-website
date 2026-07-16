"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import type { VoiceConnectionStatus } from "@/components/voice-agent/useRealtimeVoiceSession";
import {
  MEREKA_MARK_DOT,
  MEREKA_MARK_HEIGHT,
  MEREKA_MARK_PATH,
  MEREKA_MARK_VIEWBOX,
  MEREKA_MARK_WIDTH,
  MEREKA_NEBULA_PARTICLE_COUNT,
} from "@/lib/brand-motion";
import type { VoiceTurnPhase } from "@/lib/voice/latency";

const VERTEX_SHADER = `
  precision highp float;

  attribute vec3 aNebula;
  attribute vec3 aHome;
  attribute float aDelay;
  attribute float aSeed;

  uniform float uTime;
  uniform float uResolve;
  uniform float uVoice;
  uniform float uUser;
  uniform float uDpr;
  uniform vec2 uTilt;

  varying float vAlpha;
  varying vec3 vColor;

  mat3 rotateX(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
  }

  mat3 rotateY(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  }

  void main() {
    float start = aDelay * 0.38;
    float arrival = clamp((uResolve - start) / (1.0 - start), 0.0, 1.0);
    arrival = arrival * arrival * (3.0 - 2.0 * arrival);

    float orbitAngle = uTime * (0.075 + aSeed * 0.035) + aSeed * 6.2831853;
    vec3 nebula = rotateY(orbitAngle) * aNebula;
    nebula = rotateX(sin(uTime * 0.11 + aSeed * 4.0) * 0.12) * nebula;
    nebula.xy += vec2(
      sin(uTime * 0.41 + aSeed * 18.0),
      cos(uTime * 0.33 + aSeed * 13.0)
    ) * (0.012 + uVoice * 0.025 + uUser * 0.018);

    vec3 home = aHome;
    home.z += sin(uTime * 0.8 + aSeed * 21.0) * (0.006 + uVoice * 0.018);
    vec3 position = mix(nebula, home, arrival);
    position = rotateY(uTilt.x) * rotateX(uTilt.y) * position;

    float depth = 2.55 + position.z * 0.42;
    vec2 projected = position.xy * (2.22 / depth);
    gl_Position = vec4(projected, clamp(position.z / 3.2, -0.9, 0.9), 1.0);

    float pulse = 0.82 + 0.18 * sin(uTime * 1.6 + aSeed * 32.0);
    float depthScale = clamp(1.28 - position.z * 0.16, 0.72, 1.55);
    gl_PointSize = (1.1 + aSeed * 2.35 + (uVoice + uUser) * 1.5) * uDpr * depthScale * pulse;

    vec3 deepBlue = vec3(0.17, 0.34, 0.62);
    vec3 horizon = vec3(0.79, 0.84, 0.93);
    vec3 cyan = vec3(0.48, 0.77, 0.83);
    vColor = mix(deepBlue, horizon, 0.28 + aSeed * 0.72);
    vColor = mix(vColor, cyan, uUser * (0.25 + aSeed * 0.4));
    vColor += vec3(0.12, 0.1, 0.18) * uVoice;
    vAlpha = mix(0.52 + aSeed * 0.42, 0.72 + aSeed * 0.28, arrival);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float core = smoothstep(0.72, 0.05, distanceFromCenter);
    float glow = smoothstep(1.0, 0.12, distanceFromCenter);
    float alpha = (core * 0.72 + glow * 0.32) * vAlpha;
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(vColor * (0.92 + core * 0.38), alpha);
  }
`;

type NebulaMProps = {
  connectionStatus: VoiceConnectionStatus;
  turnPhase: VoiceTurnPhase;
};

type VoiceVisualState = Pick<NebulaMProps, "connectionStatus" | "turnPhase">;

type ParticleField = {
  delay: Float32Array;
  home: Float32Array;
  nebula: Float32Array;
  seed: Float32Array;
};

type ManualResolve = {
  target: number | null;
  until: number;
};

export function NebulaM({ connectionStatus, turnPhase }: NebulaMProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<VoiceVisualState>({ connectionStatus, turnPhase });
  const pointerRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const manualResolveRef = useRef<ManualResolve>({ target: null, until: 0 });
  const currentResolveRef = useRef(0);
  const [webglReady, setWebglReady] = useState(false);
  const [fallback, setFallback] = useState(false);

  stateRef.current = { connectionStatus, turnPhase };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches || typeof Path2D === "undefined") {
      setFallback(true);
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
    });
    if (!gl) {
      setFallback(true);
      return;
    }

    let program: WebGLProgram;
    let particles: ParticleField;
    try {
      program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
      particles = createParticleField();
    } catch {
      setFallback(true);
      return;
    }

    const attributes = {
      delay: requireAttribute(gl, program, "aDelay"),
      home: requireAttribute(gl, program, "aHome"),
      nebula: requireAttribute(gl, program, "aNebula"),
      seed: requireAttribute(gl, program, "aSeed"),
    };
    const uniforms = {
      dpr: requireUniform(gl, program, "uDpr"),
      resolve: requireUniform(gl, program, "uResolve"),
      tilt: requireUniform(gl, program, "uTilt"),
      time: requireUniform(gl, program, "uTime"),
      user: requireUniform(gl, program, "uUser"),
      voice: requireUniform(gl, program, "uVoice"),
    };

    const buffers = [
      bindAttribute(gl, attributes.nebula, particles.nebula, 3),
      bindAttribute(gl, attributes.home, particles.home, 3),
      bindAttribute(gl, attributes.delay, particles.delay, 1),
      bindAttribute(gl, attributes.seed, particles.seed, 1),
    ];

    // biome-ignore lint/complexity/useLiteralKeys: dot syntax is misidentified as a React hook by useHookAtTopLevel.
    gl["useProgram"](program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    let animationFrame = 0;
    let visible = !document.hidden;
    let lastFrame = performance.now();
    let autoTarget = 0;
    let nextAutoFlip = lastFrame + 2_800;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const renderWidth = Math.max(1, Math.round(width * dpr));
      const renderHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
      }
      gl.viewport(0, 0, renderWidth, renderHeight);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const onVisibilityChange = () => {
      visible = !document.hidden;
      if (visible) {
        lastFrame = performance.now();
        animationFrame = window.requestAnimationFrame(draw);
      } else {
        window.cancelAnimationFrame(animationFrame);
      }
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      window.cancelAnimationFrame(animationFrame);
      setFallback(true);
    };

    const draw = (now: number) => {
      const deltaSeconds = Math.min((now - lastFrame) / 1_000, 0.05);
      lastFrame = now;
      const state = stateRef.current;

      if (now >= nextAutoFlip) {
        autoTarget = autoTarget > 0.5 ? 0 : 1;
        nextAutoFlip = now + (autoTarget > 0.5 ? 4_100 : 3_300);
      }

      const manual = manualResolveRef.current;
      if (manual.target !== null && now >= manual.until) manual.target = null;
      const targetResolve = manual.target ?? resolveTargetForVoiceState(state, autoTarget);
      const resolveEase = 1 - Math.exp(-deltaSeconds * 1.85);
      currentResolveRef.current += (targetResolve - currentResolveRef.current) * resolveEase;

      const pointer = pointerRef.current;
      const pointerEase = 1 - Math.exp(-deltaSeconds * 4.2);
      pointer.x += (pointer.targetX - pointer.x) * pointerEase;
      pointer.y += (pointer.targetY - pointer.y) * pointerEase;

      const levelSource = canvas.closest<HTMLElement>(".voice-orb");
      const computed = levelSource ? window.getComputedStyle(levelSource) : null;
      const voiceLevel = clampLevel(computed?.getPropertyValue("--voice-level"));
      const userLevel = clampLevel(computed?.getPropertyValue("--user-level"));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      gl.clear(gl.COLOR_BUFFER_BIT);
      // biome-ignore lint/complexity/useLiteralKeys: dot syntax is misidentified as a React hook by useHookAtTopLevel.
      gl["useProgram"](program);
      gl.uniform1f(uniforms.time, now / 1_000);
      gl.uniform1f(uniforms.resolve, currentResolveRef.current);
      gl.uniform1f(uniforms.voice, voiceLevel);
      gl.uniform1f(uniforms.user, userLevel);
      gl.uniform1f(uniforms.dpr, dpr);
      gl.uniform2f(uniforms.tilt, pointer.x, pointer.y);
      gl.drawArrays(gl.POINTS, 0, MEREKA_NEBULA_PARTICLE_COUNT);

      if (visible) animationFrame = window.requestAnimationFrame(draw);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    setWebglReady(true);
    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver.disconnect();
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  const toggleResolve = () => {
    const now = performance.now();
    manualResolveRef.current = {
      target: currentResolveRef.current > 0.5 ? 0 : 1,
      until: now + 8_000,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 0.46;
    pointerRef.current.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * -0.34;
  };

  const handlePointerLeave = () => {
    pointerRef.current.targetX = 0;
    pointerRef.current.targetY = 0;
  };

  return (
    <button
      aria-label="Interactive Mereka nebula — press to resolve the stars into the M mark"
      className="mereka-nebula"
      data-fallback={fallback ? "true" : undefined}
      data-ready={webglReady && !fallback ? "true" : undefined}
      onClick={toggleResolve}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      type="button"
    >
      <svg aria-hidden className="mereka-nebula__fallback" viewBox={MEREKA_MARK_VIEWBOX}>
        <title>Mereka mark fallback</title>
        <path d={MEREKA_MARK_PATH} />
        <circle cx={MEREKA_MARK_DOT.cx} cy={MEREKA_MARK_DOT.cy} r={MEREKA_MARK_DOT.radius} />
      </svg>
      <canvas aria-hidden className="mereka-nebula__canvas" ref={canvasRef} />
    </button>
  );
}

function resolveTargetForVoiceState(state: VoiceVisualState, autoTarget: number) {
  if (state.connectionStatus === "requesting_mic" || state.connectionStatus === "connecting") return 0.18;
  if (state.connectionStatus !== "listening") return autoTarget;
  if (state.turnPhase === "user_speaking") return 0.06;
  if (state.turnPhase === "waiting_for_response") return 0.82;
  if (state.turnPhase === "assistant_speaking") return 1;
  return autoTarget;
}

function createParticleField(): ParticleField {
  const samplingCanvas = document.createElement("canvas");
  const context = samplingCanvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");

  const silhouette = new Path2D(MEREKA_MARK_PATH);
  const random = seededRandom(0x4d455245);
  const home = new Float32Array(MEREKA_NEBULA_PARTICLE_COUNT * 3);
  const nebula = new Float32Array(MEREKA_NEBULA_PARTICLE_COUNT * 3);
  const delay = new Float32Array(MEREKA_NEBULA_PARTICLE_COUNT);
  const seed = new Float32Array(MEREKA_NEBULA_PARTICLE_COUNT);

  let accepted = 0;
  while (accepted < MEREKA_NEBULA_PARTICLE_COUNT) {
    const x = random() * MEREKA_MARK_WIDTH;
    const y = random() * MEREKA_MARK_HEIGHT;
    const dotX = x - MEREKA_MARK_DOT.cx;
    const dotY = y - MEREKA_MARK_DOT.cy;
    const inDot = dotX * dotX + dotY * dotY <= MEREKA_MARK_DOT.radius * MEREKA_MARK_DOT.radius;
    if (!inDot && !context.isPointInPath(silhouette, x, y)) continue;

    const pointSeed = random();
    const homeX = (x / MEREKA_MARK_WIDTH - 0.5) * 1.72;
    const homeY = (0.5 - y / MEREKA_MARK_HEIGHT) * 1.36;
    const radialDistance = Math.min(1, Math.hypot(homeX / 0.86, homeY / 0.68));
    const offset = accepted * 3;
    home[offset] = homeX;
    home[offset + 1] = homeY;
    home[offset + 2] = (random() - 0.5) * 0.035;

    const longitude = random() * Math.PI * 2;
    const latitude = Math.acos(random() * 2 - 1);
    const radius = 0.18 + random() ** 0.46 * 1.2;
    nebula[offset] = Math.sin(latitude) * Math.cos(longitude) * radius;
    nebula[offset + 1] = Math.cos(latitude) * radius * 0.78;
    nebula[offset + 2] = Math.sin(latitude) * Math.sin(longitude) * radius;

    delay[accepted] = Math.min(0.96, radialDistance * 0.82 + random() * 0.14);
    seed[accepted] = pointSeed;
    accepted += 1;
  }

  return { delay, home, nebula, seed };
}

function seededRandom(initialSeed: number) {
  let value = initialSeed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unable to link WebGL program";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unable to compile WebGL shader";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function bindAttribute(gl: WebGLRenderingContext, location: number, values: Float32Array, componentCount: number) {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Unable to create WebGL buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, componentCount, gl.FLOAT, false, 0, 0);
  return buffer;
}

function requireAttribute(gl: WebGLRenderingContext, program: WebGLProgram, name: string) {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Missing WebGL attribute: ${name}`);
  return location;
}

function requireUniform(gl: WebGLRenderingContext, program: WebGLProgram, name: string) {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Missing WebGL uniform: ${name}`);
  return location;
}

function clampLevel(rawValue: string | undefined) {
  const value = Number.parseFloat(rawValue ?? "0");
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
