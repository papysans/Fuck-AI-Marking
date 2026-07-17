"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { SceneEnvironment } from "./SceneEnvironment";
import {
  CharacterCircle,
  CameraRig,
  ringRadius,
  cameraSetup,
  SCENE_FOV,
  SCENE_POLAR_MIN,
  SCENE_POLAR_MAX,
} from "./CharacterCircle";
import type { ScenePerformer } from "./ImmersiveScene";

/**
 * The single full-page r3f `<Canvas>` (NEVER `<View>` — proven blank in this
 * repo). Loaded client-only by `ImmersiveScene` via next/dynamic ssr:false.
 *
 * Layering: `CameraRig` POSES the orbit camera once (and re-eases it when the
 * jury size changes); `OrbitControls` owns it from then on. The ring content is
 * static — see the note in `CharacterCircle` — so the camera is the scene's one
 * and only source of rotation. Bloom is toggleable and force-off under
 * reduced-motion.
 */

/** Full ring revolution in seconds, matching the old carousel spin. */
const AUTO_ROTATE_PERIOD_S = 50;
/**
 * three-stdlib advances autoRotate by `2π/60/60 * autoRotateSpeed` per
 * `update()` and drei calls `update()` once per frame, so speed is calibrated
 * against a 60fps frame — `speed = 60 / period`. (The stdlib build ignores
 * deltaTime, so a 120Hz display orbits ~2x faster. Cosmetic, and the price of
 * using the controller's own autoRotate instead of a second rotation source.)
 */
const AUTO_ROTATE_SPEED = 60 / AUTO_ROTATE_PERIOD_S;
/** Museum standard: hands off for this long → the exhibit resumes turning. */
const IDLE_RESUME_MS = 3500;
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

  // Auto-rotate pauses the moment the user grabs the scene and resumes only
  // after they've been still for IDLE_RESUME_MS. OrbitControls already gates
  // autoRotate off mid-drag (state !== NONE), so this timer is what buys the
  // "let go and read for a second without the ring walking away" grace period.
  const [autoSpin, setAutoSpin] = useState(true);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStart = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setAutoSpin(false);
  }, []);

  const handleEnd = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setAutoSpin(true), IDLE_RESUME_MS);
  }, []);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const ring = (
    <CharacterCircle performers={performers} reducedMotion={reducedMotion} />
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

      {/* Mounted BEFORE CameraRig so `makeDefault` has published `controls` to
          the r3f store by the time the rig's effect looks for it.

          Why an orbit camera and not PresentationControls: PC rotates the
          CONTENT ("exhibit in your hand") and fences azimuth to ±0.6rad, which
          is nonsense for a ring you're meant to walk around — two drags and you
          hit a wall you can't see. Orbiting the camera is the museum semantic:
          unlimited azimuth (every reviewer reachable), damped inertia on
          release, and one authority over the view. */}
      <OrbitControls
        makeDefault
        // No pan/zoom on purpose. `rig.dist` is a compile-time constant that
        // feeds the fog band and the bubbles' `distanceFactor`; zoom would make
        // the real eye→ring distance drift away from it and silently break both.
        // Adding zoom later means deriving those from the live camera distance.
        enablePan={false}
        enableZoom={false}
        // Damping IS the inertia: release the drag and the camera coasts to a
        // stop instead of dying on the spot. drei's OrbitControls runs
        // `controls.update()` in its own useFrame (priority -1) every frame,
        // which is what damping requires — verified in drei 10.7.7's source.
        enableDamping={!reducedMotion}
        dampingFactor={0.075}
        // Azimuth deliberately unbounded: the whole point is to orbit the ring.
        minPolarAngle={SCENE_POLAR_MIN}
        maxPolarAngle={SCENE_POLAR_MAX}
        autoRotate={autoSpin && !reducedMotion}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        onStart={handleStart}
        onEnd={handleEnd}
      />
      <CameraRig radius={radius} count={performers.length} />

      <Suspense fallback={null}>
        {ring}

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
