import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import type { ScenePerformer } from "./ImmersiveScene";
import { accentHex } from "./ImmersiveScene";
import {
  characterFor,
  planFor,
  prepareCharacter,
  seedOf,
  type AnimationPlan,
  type MeasureBasis,
} from "./characters";

/**
 * One evaluator character (KayKit CC0 cast — Knight / Mage / Barbarian /
 * Skeleton Warrior, picked deterministically per performer id). Each is a
 * SkinnedMesh, so every instance MUST clone via SkeletonUtils (sharing the raw
 * scene corrupts the skeleton). Every clone owns its OWN `THREE.AnimationMixer`
 * (see below — drei's `useAnimations` is NOT safe here), an animation state
 * machine driven by the performer's status/score, and a drei `<Html>` chat
 * bubble above its head that streams the reviewer's `commentary`.
 *
 * Deterministic per-id variation (never random, never positional) so re-renders
 * and neighbour add/remove are stable.
 */

/**
 * Common BODY height for every character, in world units (see MEASURE_BASIS —
 * this is the person, hats excluded and free to stick out above it).
 *
 * Was 4.5 under the old `"silhouette"` basis, chosen to match the old
 * RobotExpressive's ~4.7-unit render (bbox 5.18 × its 0.9 scale) that the camera
 * rig, fog and bubble offsets were tuned around. Switching the basis changes what
 * this number MEASURES, so it had to be retuned or the whole cast would inflate:
 * at 4.5-per-body the mean silhouette becomes 5.31 (+18% vs the old 4.5) and the
 * Mage alone reaches 6.13 (+36%), blowing the framing.
 *
 * 4.0 is the value where the new basis lands back on the old framing. Measured
 * (bind pose, all four GLBs) — three independent checks agree:
 *
 *                       old silhouette@4.5     body@4.5      body@4.0
 *   mean silhouette        4.50 (robot ~4.7)     5.31          4.72  ← ≈ robot
 *   mean head top          2.85                  3.50          3.00  ← ≈ old
 *   mean body height       3.85                  4.50          4.00  ← ≈ old
 *
 * The four KayKit models are authored at ~2.2-2.3 units of body, so they scale
 * UP ~1.73-1.85×; the exact factor is derived per model from a runtime
 * measurement, never guessed.
 */
const TARGET_HEIGHT = 4.0;

/** Floor plane — matches `<ContactShadows position={[0,-1,0]}>`. */
const GROUND_Y = -1;

/**
 * How "same height" is measured. `"body"`: the PEOPLE match and headgear stands
 * proud of them, which is how this cast is drawn to read.
 *
 * `"silhouette"` (the old value) squeezed each character's TOTAL outline into
 * TARGET_HEIGHT, so the Mage's ~1.6-unit hat ate his budget: measured, his body
 * came out 3.30 vs the Knight's 4.22 — 21.8% shorter, a dwarf under a big hat.
 * `"body"` measures skinned meshes only, which on this cast is exactly the
 * person: every body part (Body, Head, ArmLeft/Right, LegLeft/Right, plus the
 * skeleton's Jaw, Eyes and Cloak) is a SkinnedMesh, while every headpiece
 * (`Knight_Helmet`,
 * `Mage_Hat`, `Barbarian_Hat`, `Skeleton_Warrior_Helmet`) and rigid cape is a
 * plain Mesh bolted to a bone. Verified against all four GLBs, not assumed.
 *
 * Grounding is unaffected: legs are the lowest part of every model (feet at
 * local y=0; the lowest rigid mesh is a cape at y≥0.055), so the body box's
 * `min.y` IS the full model's `min.y` and the measured feet still land exactly
 * on GROUND_Y. Bonus: since each model's body top IS its head top, all four
 * heads now line up at exactly GROUND_Y + TARGET_HEIGHT, so the fixed-height
 * chat bubbles sit consistently over every character instead of ranging 2.30
 * (Mage) to 3.22 (Knight) as they did under `"silhouette"`.
 */
const MEASURE_BASIS: MeasureBasis = "body";

export function Character({
  performer,
  count,
  viewHeight,
  reducedMotion,
}: {
  performer: ScenePerformer;
  count: number;
  /** Visible world height at the ring, from the camera rig (see CharacterCircle). */
  viewHeight: number;
  reducedMotion: boolean;
}) {
  const color = accentHex(performer.accentIndex);
  const seed = useMemo(() => seedOf(performer.id), [performer.id]);
  // Stable body for this reviewer. Only the chosen GLB is fetched (useGLTF
  // caches, so reviewers sharing a body share one download).
  const def = useMemo(() => characterFor(performer.id), [performer.id]);
  const { scene, animations } = useGLTF(def.url);

  // Independent skeleton per character.
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  // Hide duplicate equipment, tint the Glow material, and measure the model so
  // all four bodies stand the same height with their feet on the floor.
  const fit = useMemo(
    () =>
      prepareCharacter(clone, {
        def,
        accent: color,
        targetHeight: TARGET_HEIGHT,
        groundY: GROUND_Y,
        basis: MEASURE_BASIS,
      }),
    [clone, def, color],
  );

  // Which clips this particular model actually has (Skeleton_Warrior has 95,
  // the others 76), with all static `*_Pose` / `T-Pose` entries filtered out.
  const plan: AnimationPlan = useMemo(() => planFor(animations), [animations]);

  /**
   * ── Bug 3 core ──────────────────────────────────────────────────────────
   * We own the mixer instead of using drei's `useAnimations(animations, group)`:
   * drei binds actions lazily through a getter that returns `undefined` while
   * `groupRef.current` is null. `play()` swallowed that (`if (!next) return`), so
   * any transition evaluated before the ref attached was dropped FOREVER — a
   * permanently dead state machine, no retry. Binding to `clone` (never null,
   * unique per character) kills that, and owning the mixer means nothing
   * external ever stops our actions.
   *
   * ── THE IRON RULE: mixer, actions and bindings are ONE lifetime ──────────
   * The mixer and its actions are built together in the effect below and dropped
   * together in its cleanup. An action NEVER outlives the mixer that made it.
   *
   * This is not stylistic. The previous attempt memoized `{mixer, actions}` and
   * called `mixer.uncacheRoot(clone)` on cleanup, betting that three's
   * `_activateAction` "this action has been forgotten by the cache -> rebind"
   * path made replaying a memoized action safe. That bet is FALSE and it is why
   * adding a character mid-stream threw `Cannot set properties of undefined
   * (setting '_cacheIndex')`:
   *
   *   - `useMemo` is NOT invalidated by an effect cleanup, so a StrictMode
   *     mount→cleanup→mount handed the SAME action objects back to a mixer whose
   *     caches `uncacheRoot` had just emptied.
   *   - `_removeInactiveAction` nulls `action._cacheIndex`, so the ACTION cache
   *     really can resurrect itself. But `_removeInactiveBinding` does NOT null
   *     `binding._cacheIndex` — a removed PropertyMixer keeps a stale index while
   *     `mixer._bindings` is empty. So `_bindAction`'s `if (binding._cacheIndex
   *     === null)` guard reads false, the binding is never re-added, and the very
   *     next `_activateAction` → `_lendBinding` does `mixer._bindings[0]
   *     ._cacheIndex = …` on an empty array → TypeError on undefined.
   *
   * So: the action cache tolerates reuse-after-uncache, the binding cache does
   * not. We therefore never uncache and never reuse. A rebuilt mixer always gets
   * brand-new `clipAction` objects; nothing else holds a reference to the old
   * mixer, so it is plain garbage (bindings point at `clone`, never the reverse
   * — no leak, no need for uncacheRoot).
   */
  interface Rig {
    mixer: THREE.AnimationMixer;
    actions: Record<string, THREE.AnimationAction>;
  }
  const rig = useRef<Rig | null>(null);
  const active = useRef<THREE.AnimationAction | null>(null);
  // Bumped on every rig (re)build so the status effect below re-asserts the
  // desired pose onto the FRESH actions instead of leaving the character frozen.
  const [rigId, setRigId] = useState(0);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clone);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of animations) actions[clip.name] = mixer.clipAction(clip, clone);
    rig.current = { mixer, actions };
    active.current = null;
    setRigId((v) => v + 1);
    return () => {
      // Drop the rig FIRST: from here on `play()` and the frame loops read
      // `rig.current === null` and no-op, so not a single call can land on an
      // action of the mixer we are tearing down.
      rig.current = null;
      active.current = null;
      // Safe: `_bindings` is fully intact here, so deactivation is reversible
      // bookkeeping. It also restores the clone's bind pose for the next rig.
      // Deliberately NO uncacheRoot — see above.
      mixer.stopAllAction();
    };
  }, [clone, animations]);

  useFrame((_, dt) => rig.current?.mixer.update(dt));

  // Crossfade helper (0.3s). Under reduced-motion: snap to a static pose frame.
  const play = useCallback(
    (
      name: string | null,
      opts?: { once?: boolean; timeScale?: number; phase?: number },
    ) => {
      // `name` is null when a model has no clip for this state — never let that
      // reach the mixer. Always resolved from the LIVE rig, never a captured
      // action object.
      if (!name) return;
      const next = rig.current?.actions[name];
      if (!next || active.current === next) return;
      const prev = active.current;
      next.reset();
      next.enabled = true;
      if (opts?.once) {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
      } else {
        next.setLoop(THREE.LoopRepeat, Infinity);
      }
      next.setEffectiveTimeScale(opts?.timeScale ?? 1);
      next.setEffectiveWeight(1);
      if (opts?.phase) next.time = opts.phase;
      next.fadeIn(0.3).play();
      if (prev) prev.fadeOut(0.3);
      if (reducedMotion) {
        // Freeze on target pose (no motion), but still show win/lose poses.
        next.paused = true;
        if (prev) prev.stop();
      }
      active.current = next;
    },
    [reducedMotion],
  );

  // React to status/score changes → drive the state machine.
  const statusRef = useRef(performer.status);
  const streamTimer = useRef(0);
  const streamStep = useRef(0);

  // Stable per-character variation (phase offset / timeScale / gesture order).
  const timeScale = 0.9 + (seed % 3) * 0.1;

  useEffect(() => {
    statusRef.current = performer.status;
    switch (performer.status) {
      case "pending":
        play(plan.pending, {
          phase: (seed % 8) * 0.25, // stagger idle phase
        });
        break;
      case "streaming":
        streamTimer.current = 0;
        streamStep.current = 0;
        if (plan.stream.length > 0) {
          play(plan.stream[seed % plan.stream.length], { timeScale });
        }
        break;
      case "done":
        play(
          performer.score != null && performer.score >= 60 ? plan.win : plan.lose,
          { once: true },
        );
        break;
      case "error":
        play(plan.error, { once: true });
        break;
    }
    // `rigId` is in deps so that whenever the rig is rebuilt (clone change, or a
    // StrictMode remount) the desired pose is re-asserted onto the FRESH actions
    // rather than lost. `active` is nulled on every rebuild, so the identity
    // early-return in `play()` can never swallow that re-assert.
  }, [performer.status, performer.score, seed, timeScale, play, rigId, plan]);

  // Streaming = "arguing": swap gestures every 2-4s, staggered per character.
  useFrame((_, dt) => {
    if (statusRef.current !== "streaming" || reducedMotion) return;
    if (plan.stream.length === 0) return;
    streamTimer.current += dt;
    const interval = 2 + (seed % 3); // 2s, 3s, 4s
    if (streamTimer.current >= interval) {
      streamTimer.current = 0;
      streamStep.current += 1;
      const name = plan.stream[(streamStep.current + seed) % plan.stream.length];
      play(name, { timeScale });
    }
  });

  return (
    <group>
      {/* Scale + ground offset are MEASURED per model (see prepareCharacter),
          so all four bodies read the same height and every pair of feet lands
          on the ContactShadows plane at y=-1. The models' own +Z is their
          forward (verified: eyes/jaw sit at +Z, capes at -Z), which is what the
          ring's `angle + π` yaw already assumes — no extra offset needed. */}
      <primitive object={clone} position={[0, fit.y, 0]} scale={fit.scale} />
      <CharacterBubble
        performer={performer}
        color={color}
        count={count}
        viewHeight={viewHeight}
      />
    </group>
  );
}

/**
 * Head chat bubble. billboard-facing DOM via drei `<Html>` (always faces
 * camera), distance-scaled, fixed size with internal scroll + auto stick to
 * bottom while streaming. `pointer-events:auto` on the bubble only, so it can
 * be scrolled without stealing camera drags from the surrounding empty space.
 *
 * Anti-clutter for many reviewers:
 * - Base size + `distanceFactor` shrink as `count` grows (5-6 bubbles never
 *   blow up into each other).
 * - A per-frame "front-ness" test (is this character on the camera-facing side
 *   of the slowly spinning ring?) fades + shrinks bubbles that have rotated to
 *   the BACK into a small dim badge, so only the front-facing reviewers stay
 *   readable and the on-screen text never smears together.
 */
function CharacterBubble({
  performer,
  color,
  count,
  viewHeight,
}: {
  performer: ScenePerformer;
  color: string;
  count: number;
  viewHeight: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const { status, commentary, score } = performer;

  // Reusable temporaries (avoid per-frame allocation).
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);

  // Per-frame: shrink/fade bubbles rotated to the back of the ring so front
  // ones stay legible. Done imperatively on the DOM wrapper (no React churn).
  useFrame(() => {
    const wrap = wrapRef.current;
    const holder = holderRef.current;
    if (!wrap || !holder) return;
    holder.getWorldPosition(tmp.pos);
    // Flatten to XZ: character direction from ring center vs. camera direction.
    tmp.a.set(tmp.pos.x, 0, tmp.pos.z);
    if (tmp.a.lengthSq() > 1e-4) tmp.a.normalize();
    tmp.b.set(camera.position.x, 0, camera.position.z);
    if (tmp.b.lengthSq() > 1e-4) tmp.b.normalize();
    const dot = tmp.a.dot(tmp.b); // +1 front (near camera) … -1 back
    const readable = THREE.MathUtils.smoothstep(dot, -0.2, 0.55); // 0..1
    wrap.style.opacity = (0.12 + readable * 0.88).toFixed(3);
    wrap.style.transform = `scale(${(0.5 + readable * 0.5).toFixed(3)})`;
    wrap.style.pointerEvents = readable > 0.5 ? "auto" : "none";
  });

  // Stick to bottom on new tokens while streaming.
  useEffect(() => {
    if (status !== "streaming") return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [commentary, status]);

  const hasText = commentary.trim().length > 0;
  const show = status === "streaming" || hasText || status === "error";

  // Size converges as reviewers pile up.
  const many = count >= 5;
  const width = many ? 186 : 220;
  const bodyFont = many ? 11.5 : 12.5;
  const bodyMaxH = many ? 96 : 118;
  /**
   * drei `<Html distanceFactor>` renders at `factor / visibleWorldHeight` of the
   * viewport, so a hard-coded factor silently shrinks the text whenever the
   * camera pulls back or narrows its lens (as the Bug 1 rig does). Derive it
   * from the actual rig instead: bubbles then keep a CONSTANT on-screen size no
   * matter how the framing is retuned. The `count` term keeps the original
   * "fewer reviewers → roomier bubbles" taper.
   */
  const distanceFactor = viewHeight * (0.86 - Math.min(count, 6) * 0.073);

  return (
    <group ref={holderRef} position={[0, 2.1, 0]}>
    <Html
      center
      distanceFactor={distanceFactor}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <div
        ref={wrapRef}
        style={{ transformOrigin: "center bottom", willChange: "transform, opacity" }}
      >
      {show ? (
        <div style={{ pointerEvents: "none", width }}>
          <div
            style={{
              pointerEvents: "auto",
              position: "relative",
              maxWidth: width,
              maxHeight: 160,
              overflowY: "auto",
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(18,19,28,0.94)",
              border: `1.5px solid ${color}`,
              boxShadow: `0 0 16px ${color}55`,
              color: "#F5F1E6",
              fontFamily: "Nunito, sans-serif",
              fontSize: bodyFont,
              lineHeight: 1.45,
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: 6,
                fontFamily: "Fredoka, sans-serif",
                fontWeight: 600,
                fontSize: 12,
                color,
                position: "sticky",
                top: -10,
                background: "rgba(18,19,28,0.94)",
                paddingTop: 2,
              }}
            >
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {performer.name}
              </span>
              {status === "done" && score != null && (
                <span
                  style={{
                    flex: "none",
                    fontWeight: 700,
                    fontSize: 12,
                    padding: "1px 8px",
                    borderRadius: 999,
                    color: "#12131C",
                    background: score >= 60 ? "#57E0A6" : "#FF5C7A",
                  }}
                >
                  {score}
                </span>
              )}
            </div>
            <div ref={scrollRef} style={{ maxHeight: bodyMaxH, overflowY: "auto" }}>
              {hasText ? commentary : status === "streaming" ? "…" : "—"}
            </div>
          </div>
          {/* tail pointing down at the character */}
          <div
            style={{
              width: 0,
              height: 0,
              margin: "-1px auto 0",
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderTop: `9px solid ${color}`,
            }}
          />
        </div>
      ) : (
        // pending & empty → tiny "…" pill
        <div
          style={{
            pointerEvents: "none",
            padding: "3px 10px",
            borderRadius: 999,
            background: "rgba(18,19,28,0.7)",
            border: `1px solid ${color}`,
            color: "#F5F1E6",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
          }}
        >
          …
        </div>
      )}
      </div>
    </Html>
    </group>
  );
}
