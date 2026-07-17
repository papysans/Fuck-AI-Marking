"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { SceneEnvironment } from "./SceneEnvironment";
import { createFocusAnchors } from "./focus";
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
  focusedId,
  bloom,
  showBubbles,
  reducedMotion,
}: {
  performers: ScenePerformer[];
  extracting: boolean;
  focusedId: string | null;
  bloom: boolean;
  /** Already defaulted by ImmersiveScene — required here, never guessed. */
  showBubbles: boolean;
  reducedMotion: boolean;
}) {
  const radius = ringRadius(performers.length);
  const rig = cameraSetup(radius, performers.length);

  // Resolve the focus request against reality ONCE, here, so nothing downstream
  // has to decide what an id nobody owns means: a stale/unknown id is simply no
  // focus (→ panorama), never "aim at nothing".
  const focus = useMemo(
    () => (focusedId && performers.some((p) => p.id === focusedId) ? focusedId : null),
    [focusedId, performers],
  );

  // Face-anchor registry (see focus.ts). The epoch is what re-runs the rig when
  // a character mounts, so focusing a reviewer whose GLB is still loading lands
  // as soon as it's there instead of being dropped.
  const [anchorEpoch, setAnchorEpoch] = useState(0);
  const anchors = useMemo(
    () => createFocusAnchors(() => setAnchorEpoch((e) => e + 1)),
    [],
  );

  /**
   * Reveal beat trigger. Fires ONCE per "the whole jury has landed", NOT per
   * reviewer finishing: with 3-6 agents streaming concurrently, a per-performer
   * camera move would mean several overlapping nudges — the camera twitching
   * exactly when the user starts reading. One beat, one moment. (And the rig
   * spends it on the LENS, not the rig — see REVEAL_FOV_DELTA.)
   */
  const settled =
    performers.length > 0 &&
    performers.every((p) => p.status === "done" || p.status === "error") &&
    performers.some((p) => p.status === "done");
  const [revealKey, setRevealKey] = useState(0);
  useEffect(() => {
    if (settled) setRevealKey((v) => v + 1);
  }, [settled]);

  // Auto-rotate pauses the moment the user grabs the scene and resumes only
  // after they've been still for IDLE_RESUME_MS. OrbitControls already gates
  // autoRotate off mid-drag (state !== NONE), so this timer is what buys the
  // "let go and read for a second without the ring walking away" grace period.
  //
  // Starts FALSE: the opening move owns the first ~1.4s, and landing it hands
  // over via the same idle timer, so the exhibit begins turning 3.5s after it
  // settles rather than under the camera's feet. (Reduced-motion never spins
  // regardless — `autoRotate` is gated on it below.)
  const [autoSpin, setAutoSpin] = useState(false);
  const [cinematic, setCinematic] = useState(false);
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

  // `autoSpin` starts false so the opening move isn't fought for the azimuth,
  // and it's the LANDING that arms the idle timer. But reduced-motion skips the
  // opening move entirely — so nothing would ever arm it, and a user who later
  // turns reduced-motion OFF would be left with a ring that never turns again.
  // Arm it here for the no-cinematic path. (Landing re-arms on top of this;
  // handleStart/handleEnd are idempotent.)
  useEffect(() => {
    if (!reducedMotion) handleEnd();
  }, [reducedMotion, handleEnd]);

  /**
   * A scripted move started/landed. Reuses the drag handlers verbatim: a
   * cinematic is, for the purposes of "when may the ring start turning again?",
   * exactly a hands-on period — kill the spin now, re-arm the same 3.5s grace on
   * release. That's the "既有逻辑" the spec asks focus-out to restore.
   */
  const handleCinematic = useCallback(
    (flying: boolean) => {
      setCinematic(flying);
      if (flying) handleStart();
      else handleEnd();
    },
    [handleStart, handleEnd],
  );

  const ring = (
    <CharacterCircle
      performers={performers}
      focusedId={focus}
      anchors={anchors}
      showBubbles={showBubbles}
      reducedMotion={reducedMotion}
    />
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
        // No pan/zoom on purpose — but the reason has CHANGED, so don't re-read
        // the old one: the bubbles no longer depend on the camera sitting at
        // `rig.dist` (they now divide the live distance back out per frame, see
        // CharacterBubble) and fog never did (it's per-fragment off the live
        // camera). What zoom would break now is FOCUS: the close-up is a framing
        // the rig computes from a known FOCUS_DIST, and a user-zoomed distance
        // would be silently overwritten by it. Pan would likewise fight the
        // rig's ownership of `controls.target`.
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
        // Off while focused (the close-up must hold still, and the user's own
        // drag is the only thing allowed to move it) and off during any scripted
        // move — autoRotate drives AZIMUTH, which is the one axis a focus flight
        // also claims. Gating it here is what makes "never two sources of
        // rotation" a fact rather than a hope.
        autoRotate={autoSpin && !reducedMotion && !focus && !cinematic}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        onStart={handleStart}
        onEnd={handleEnd}
      />
      <CameraRig
        radius={radius}
        count={performers.length}
        focusedId={focus}
        anchors={anchors}
        anchorEpoch={anchorEpoch}
        revealKey={revealKey}
        reducedMotion={reducedMotion}
        onCinematic={handleCinematic}
      />

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
