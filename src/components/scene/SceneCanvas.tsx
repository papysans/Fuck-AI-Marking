"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { PresentationControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { SceneEnvironment } from "./SceneEnvironment";
import { RobotCircle, CameraRig, ringRadius } from "./RobotCircle";
import type { ScenePerformer } from "./ImmersiveScene";

/**
 * The single full-page r3f `<Canvas>` (NEVER `<View>` — proven blank in this
 * repo). Loaded client-only by `ImmersiveScene` via next/dynamic ssr:false.
 *
 * Layering: a fixed `CameraRig` frames the ring from outside; the ring itself
 * self-rotates (inside `RobotCircle`); `PresentationControls` wraps the ring on
 * an outer group so pointer drag only tilts and never fights the spin. Bloom is
 * toggleable and force-off under reduced-motion.
 */
export default function SceneCanvas({
  performers,
  extracting,
  bloom,
  reducedMotion,
}: {
  performers: ScenePerformer[];
  extracting: boolean;
  bloom: boolean;
  reducedMotion: boolean;
}) {
  const radius = ringRadius(performers.length);

  const ring = (
    <RobotCircle performers={performers} reducedMotion={reducedMotion} />
  );

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 7, 16], fov: 40 }}>
      <color attach="background" args={["#12131c"]} />
      {/* fog starts beyond the near (front) robots and hazes the back of the
          ring for depth; widened to match the pulled-back camera. */}
      <fog attach="fog" args={["#12131c", radius * 2 + 12, radius * 2 + 34]} />

      <SceneEnvironment />
      <CameraRig radius={radius} count={performers.length} />

      <Suspense fallback={null}>
        {reducedMotion ? (
          ring
        ) : (
          <PresentationControls
            global
            snap
            polar={[-0.15, 0.35]}
            azimuth={[-0.5, 0.5]}
            damping={0.25}
          >
            {ring}
          </PresentationControls>
        )}

        {extracting && (
          <Html center position={[0, 0.4, 0]} style={{ pointerEvents: "none" }}>
            <div
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: "rgba(18,19,28,0.85)",
                border: "1px solid #ffc24b",
                color: "#ffc24b",
                fontFamily: "Fredoka, sans-serif",
                fontWeight: 600,
                fontSize: 14,
                whiteSpace: "nowrap",
              }}
            >
              要点抽取中…
            </div>
          </Html>
        )}
      </Suspense>

      {bloom && !reducedMotion && (
        <EffectComposer enableNormalPass={false}>
          <Bloom
            mipmapBlur
            intensity={0.6}
            luminanceThreshold={0.9}
            luminanceSmoothing={0.2}
          />
          <Vignette offset={0.2} darkness={0.6} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
