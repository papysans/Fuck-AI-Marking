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
  /**
   * Fly the camera to a close-up of this performer's face. `null`/omitted (the
   * default) = the wide ring shot. Purely additive: callers that never pass it
   * get exactly the previous behaviour.
   *
   * An id that matches no performer is treated as no focus, so a caller may
   * hand over ids optimistically without racing the performer list. While
   * focused the ring stops auto-rotating, but the user can still drag to orbit
   * around the face.
   */
  focusedId?: string | null;
  /**
   * Master switch for the head chat bubbles. `true` (the default) = previous
   * behaviour exactly, so callers that never pass it are unaffected.
   *
   * This exists because the bubbles are a PHASE, not a permanent fixture: they
   * are the only information source while the jury argues, and pure noise once
   * the producer's summary panel says the same thing better. The scene has no
   * idea what a "phase" is and must not learn — so the owner of the narrative
   * (ImmersiveShell) states it here, in the one vocabulary the scene has:
   * bubbles on, or bubbles off.
   *
   * Independent of focus, and they STACK: focus already hides every bubble
   * (`focused || dimmed`), and this hides them regardless of focus. Neither rule
   * knows about the other; a bubble shows only when both allow it.
   */
  showBubbles?: boolean;
}): React.JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <SceneCanvas
      performers={props.performers}
      extracting={props.extracting}
      focusedId={props.focusedId ?? null}
      bloom={props.bloom ?? true}
      showBubbles={props.showBubbles ?? true}
      reducedMotion={reducedMotion}
    />
  );
}
