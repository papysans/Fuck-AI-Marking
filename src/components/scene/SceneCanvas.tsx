"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { PresentationControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { SceneEnvironment } from "./SceneEnvironment";
import {
  RobotCircle,
  CameraRig,
  ringRadius,
  cameraSetup,
  SCENE_FOV,
} from "./RobotCircle";
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
  const rig = cameraSetup(radius, performers.length);

  const ring = (
    <RobotCircle performers={performers} reducedMotion={reducedMotion} />
  );

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // Seed the camera at the rig's own pose so the first frame doesn't flash
      // the old close-up before CameraRig's effect lands.
      camera={{ position: [0, rig.height, rig.distH], fov: SCENE_FOV }}
    >
      <color attach="background" args={["#12131c"]} />
      {/* Fog is measured from the CAMERA, so it must track the rig: the museum
          camera sits ~29 units out, where the old fixed near-plane (~20) would
          have swallowed the entire ring in haze. Anchor it just past the near
          robots and let it fade the back of the ring for depth. */}
      <fog
        attach="fog"
        args={["#12131c", rig.dist + radius * 0.3, rig.dist + radius * 2 + 16]}
      />

      <SceneEnvironment />
      <CameraRig radius={radius} count={performers.length} />

      <Suspense fallback={null}>
        {reducedMotion ? (
          ring
        ) : (
          /* Bug 2: NO `snap`. drei does
             `animation.rotation = snap && !down ? rInitial : [y, x, 0]`, i.e.
             `snap` springs the ring back to its initial rotation the instant the
             pointer lifts. Without it the last dragged angle is kept as the
             damped target, so the view stays exactly where the user left it.
             `damping` still gives the eased feel, and polar/azimuth still fence
             the ring in. The slow spin lives on an INNER group, so it keeps
             composing on top of the user's persistent offset. */
          <PresentationControls
            global
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
