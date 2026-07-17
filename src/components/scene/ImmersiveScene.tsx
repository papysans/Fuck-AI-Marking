"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

/**
 * Public, data-driven entry point for the immersive grading stage. The real app
 * feeds it a list of reviewer "performers" (one per grading Agent) plus an
 * `extracting` flag (Stage A key-point extraction in flight). Everything about
 * the 3D show — robot count, poses, per-robot streaming chat bubbles, the slow
 * carousel spin — is derived from this data.
 *
 * The heavy WebGL `<Canvas>` lives in `SceneCanvas` and is loaded client-only
 * via `next/dynamic({ ssr: false })` from inside here, so integrators can drop
 * `<ImmersiveScene />` into any (even server) tree without SSR blowing up.
 */

/** Voice-color accent per reviewer (maps to design-system `--agent-1..6`). */
export const AGENT_ACCENTS = [
  "#ff5c7a",
  "#ffc24b",
  "#57e0a6",
  "#5ab4ff",
  "#b98bff",
  "#ff8ad1",
] as const;

export function accentHex(accentIndex: number): string {
  return AGENT_ACCENTS[(accentIndex - 1 + AGENT_ACCENTS.length * 100) % 6];
}

export interface ScenePerformer {
  id: string;
  name: string;
  accentIndex: number; // 1..6 → --agent-N
  status: "pending" | "streaming" | "done" | "error";
  score?: number;
  /** Live streamed review text for this reviewer (drives the head bubble). */
  commentary: string;
}

const SceneCanvas = dynamic(() => import("./SceneCanvas"), { ssr: false });

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function ImmersiveScene(props: {
  performers: ScenePerformer[];
  extracting: boolean;
  /** Optional post-processing bloom toggle (defaults on; off under reduced-motion). */
  bloom?: boolean;
}): React.JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <SceneCanvas
      performers={props.performers}
      extracting={props.extracting}
      bloom={props.bloom ?? true}
      reducedMotion={reducedMotion}
    />
  );
}
