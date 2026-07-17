import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import type { ScenePerformer } from "./ImmersiveScene";
import { accentHex } from "./ImmersiveScene";
import type { FocusAnchors } from "./focus";
import {
  characterFor,
  planFor,
  prepareCharacter,
  seedOf,
  FACE_LIFT,
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
 * Focus is a SOLO, not a spotlight: everyone who is not the focused reviewer
 * fades to nothing and leaves the stage. Two reasons, both from real use:
 *
 * 1. The user asked for it — "点开一个回答，就只显示这个回答以及这个 Agent".
 * 2. The close-up puts the eye INSIDE the ring (see FOCUS_DIST), so the far side
 *    of the circle is no longer safely behind the camera: at N=6 the characters
 *    at ±60° project to ~33° off-axis against a ~28.5° half-fov — and the lateral
 *    truck that ducks the UI panel swings that to ~24°, i.e. INTO the right edge
 *    of frame, exactly where the subject is supposed to be alone.
 *
 * Target 0 rather than a low opacity: at 0 the group leaves the scene graph, which
 * also takes its ContactShadows blob off the floor. A dimmed-but-present ghost
 * would keep casting a full-strength shadow (drei renders that pass with an
 * override depth material, which ignores our opacity) — a shadow under nobody.
 */
const SOLO_LAMBDA = 6;

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
  refDist,
  anchors,
  focused,
  dimmed,
  showBubbles,
  reducedMotion,
}: {
  performer: ScenePerformer;
  count: number;
  /** Visible world height at the ring, from the camera rig (see CharacterCircle). */
  viewHeight: number;
  /** Resting eye→ring distance the bubble sizing is normalised against. */
  refDist: number;
  anchors: FocusAnchors;
  /** This character is the one the camera is closing in on. */
  focused: boolean;
  /** SOMEONE ELSE is focused → yield the stage. */
  dimmed: boolean;
  /** Master switch for the head bubble — see ImmersiveScene. Body is unaffected. */
  showBubbles: boolean;
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
      opts?: {
        once?: boolean;
        timeScale?: number;
        phase?: number;
        /** Re-fire even if this action is already the active one. */
        force?: boolean;
      },
    ) => {
      // `name` is null when a model has no clip for this state — never let that
      // reach the mixer. Always resolved from the LIVE rig, never a captured
      // action object.
      if (!name) return;
      const next = rig.current?.actions[name];
      if (!next) return;
      // `force` exists for the focus gesture: its clip is resolved by
      // availability and can legitimately BE the clip already running (e.g.
      // Spellcast_Raise is both a focus gesture and a streaming gesture), in
      // which case the identity guard would silently swallow the whole gesture.
      const restart = active.current === next;
      if (restart && !opts?.force) return;
      const prev = restart ? null : active.current;
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
      if (restart) {
        // Re-firing the SAME action: play it at full weight. `fadeIn` would ramp
        // the only active action from weight 0, and a lone sub-weight action
        // blends toward the BIND POSE — i.e. the character would visibly melt
        // for 0.3s instead of snapping into the gesture.
        next.play();
      } else {
        next.fadeIn(0.3).play();
        if (prev) prev.fadeOut(0.3);
      }
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
  /** A one-shot focus gesture is on screen and owns the body until it ends. */
  const gesturing = useRef(false);

  // Stable per-character variation (phase offset / timeScale / gesture order).
  const timeScale = 0.9 + (seed % 3) * 0.1;

  /**
   * Put the character into whatever pose its CURRENT status calls for. Extracted
   * from the effect below so the focus gesture has something to hand control
   * back to — the state machine stays the single definition of "what should this
   * character be doing", and the gesture is a temporary override, not a fork.
   */
  const applyStatus = useCallback(() => {
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
  }, [performer.status, performer.score, seed, timeScale, play, plan]);

  // Always-current handle on `applyStatus`. The gesture effect below reads the
  // state machine through THIS and never through its own deps — see there.
  const applyStatusRef = useRef(applyStatus);
  useEffect(() => {
    applyStatusRef.current = applyStatus;
  });

  useEffect(() => {
    statusRef.current = performer.status;
    applyStatus();
    // `rigId` is in deps so that whenever the rig is rebuilt (clone change, or a
    // StrictMode remount) the desired pose is re-asserted onto the FRESH actions
    // rather than lost. `active` is nulled on every rebuild, so the identity
    // early-return in `play()` can never swallow that re-assert.
  }, [performer.status, applyStatus, rigId]);

  /**
   * Focus gesture: one showy clip, then back to the state machine.
   *
   * Deps are the focus TRIGGER only — emphatically NOT `applyStatus`. If the
   * status effect's identity were a dep, a status change mid-gesture would tear
   * this effect down and re-run it, i.e. REPLAY the gesture instead of letting
   * the state machine take over. Reading it through a ref makes the takeover
   * one-directional: status changes flow into `play()` via the effect above,
   * this effect never notices, and the pending timer below lands on whatever the
   * latest status is (a no-op, since `play()` early-returns on the same action).
   *
   * Skipped entirely under reduced-motion: `play()` would freeze the gesture on
   * a single frame, which is a pose change with no meaning. The bubble emphasis
   * carries the focus instead.
   */
  useEffect(() => {
    if (!focused || reducedMotion || !plan.focus) return;
    const clip = animations.find((c) => c.name === plan.focus);
    play(plan.focus, { once: true, force: true });
    // Hold off the streaming gesture-cycler below, which would otherwise
    // crossfade this away after as little as 2s (its timer keeps running
    // independently of focus) and cut the gesture short.
    gesturing.current = true;
    let handedBack = false;
    const t = setTimeout(
      () => {
        handedBack = true;
        gesturing.current = false;
        applyStatusRef.current();
      },
      (clip?.duration ?? 1) * 1000 + 60, // +60ms so the clamped last frame lands
    );
    return () => {
      clearTimeout(t);
      gesturing.current = false;
      // Focus revoked (or unmount) mid-gesture: the clip is LoopOnce +
      // clampWhenFinished, so without this the character would be welded into
      // the gesture's final frame forever.
      if (!handedBack) applyStatusRef.current();
    };
  }, [focused, plan.focus, reducedMotion, play, animations]);

  // Streaming = "arguing": swap gestures every 2-4s, staggered per character.
  useFrame((_, dt) => {
    if (statusRef.current !== "streaming" || reducedMotion) return;
    // A focus gesture outranks the argue loop. `applyStatus` re-zeroes
    // streamTimer when it hands back, so the next swap is a full interval away
    // rather than firing the instant the gesture ends.
    if (gesturing.current) return;
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

  /**
   * Height of this character's FACE, between the measured neck joint and the
   * measured crown. Per-model by construction: the four GLBs share a skeleton
   * but are authored at different body heights, so the same joint normalises to
   * a different world height on each (≈1.14 for the Knight, ≈1.29 for the
   * Skeleton). Never hardcoded.
   */
  const faceY = fit.headY + (fit.topY - fit.headY) * FACE_LIFT;

  /**
   * Solo fade (see SOLO_LAMBDA). Driven imperatively — a per-frame `setState`
   * would re-render this subtree ~60x a second for a value only three.js reads.
   *
   * `fit.materials` are PRIVATE to this character (see `prepareCharacter`), which
   * is the whole reason writing `opacity` here is safe: they used to be shared
   * with every other clone of the same GLB, so this loop would have dimmed the
   * focused reviewer too whenever a dimmed one happened to wear the same body.
   */
  const bodyRef = useRef<THREE.Group>(null);
  /**
   * INVARIANT: `solo.current` is always what is actually applied to the
   * materials. It therefore starts at 1 because `prepareCharacter` hands them
   * back opaque — do NOT "optimise" this to `useRef(dimmed ? 0 : 1)`. A character
   * mounting while someone else is focused would then start latched (see below)
   * on a value it never wrote, and render fully opaque forever.
   */
  const solo = useRef(1);
  const soloTransparent = useRef(false);
  useFrame((_, dt) => {
    const target = dimmed ? 0 : 1;
    // Latched: once settled we stop touching materials entirely, so the common
    // case (nobody focused) costs one comparison per character per frame.
    if (solo.current === target) return;
    let o = reducedMotion
      ? target
      : THREE.MathUtils.damp(solo.current, target, SOLO_LAMBDA, dt);
    // Land EXACTLY, or the latch above can never engage and `visible` would sit
    // one epsilon short of off forever.
    if (Math.abs(o - target) < 0.004) o = target;
    solo.current = o;

    const transparent = o < 1;
    const flipped = transparent !== soloTransparent.current;
    soloTransparent.current = transparent;
    for (const m of fit.materials) {
      m.transparent = transparent;
      m.opacity = o;
      /**
       * `needsUpdate` here is LOAD-BEARING, not defensive — do not drop it as a
       * redundant per-flip cost. Verified against three r180's own source:
       * `material.transparent` feeds `parameters.opaque`, which is program cache
       * key layer 17, and the opaque variant compiles `#define OPAQUE` — under
       * which `opaque_fragment.glsl` runs `diffuseColor.a = 1.0` and DISCARDS the
       * `opacity` uniform in the shader itself. Without the re-fetch the material
       * would keep its opaque program and every write above would be silently
       * ignored: the fade would render at full opacity and nothing would error.
       *
       * Only on the flip, never per frame — and the transparent variant is cached
       * from then on, so it costs a cache lookup, not a shader compile.
       */
      if (flipped) m.needsUpdate = true;
    }
    // Fully faded → out of the scene graph: no draw call, no contact shadow.
    const g = bodyRef.current;
    if (g) g.visible = o > 0;
  });

  // Publish the face anchor for the camera rig. Keyed by performer.id, dropped
  // on unmount, so a rig aiming at a character that just left the jury finds
  // nothing rather than a stale group.
  const anchorRef = useRef<THREE.Group>(null);
  useEffect(() => {
    const obj = anchorRef.current;
    if (!obj) return;
    return anchors.register(performer.id, obj);
  }, [anchors, performer.id, faceY]);

  return (
    <group>
      {/* Empty face anchor — see focus.ts for why this and not the head BONE.
          It inherits the ring group's yaw and nothing else, so its world +Z is
          exactly the direction this character is facing; the rig reads its
          close-up azimuth straight off that. */}
      <group ref={anchorRef} position={[0, faceY, 0]} />
      {/* Scale + ground offset are MEASURED per model (see prepareCharacter),
          so all four bodies read the same height and every pair of feet lands
          on the ContactShadows plane at y=-1. The models' own +Z is their
          forward (verified: eyes/jaw sit at +Z, capes at -Z), which is what the
          ring's `angle + π` yaw already assumes — no extra offset needed.

          Wrapped so the solo fade has ONE `visible` to switch: the face anchor
          above is a deliberate sibling, so hiding the body can never take the
          camera rig's focus target down with it. */}
      <group ref={bodyRef}>
        <primitive object={clone} position={[0, fit.y, 0]} scale={fit.scale} />
      </group>
      <CharacterBubble
        performer={performer}
        color={color}
        count={count}
        viewHeight={viewHeight}
        refDist={refDist}
        focused={focused}
        dimmed={dimmed}
        showBubbles={showBubbles}
        reducedMotion={reducedMotion}
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
 * These bubbles are the ONLY information source during the argue phase — there is
 * no side panel until a reviewer is focused — so they are sized to be READ. See
 * `distanceFactor` below for what that costs and how far it can go.
 *
 * Anti-clutter for many reviewers:
 * - Base size + `distanceFactor` shrink as `count` grows (5-6 bubbles never
 *   blow up into each other).
 * - A per-frame "front-ness" test (is this character on the camera-facing side
 *   of the slowly spinning ring?) fades + shrinks bubbles that have rotated to
 *   the BACK into a small dim badge, so only the front-facing reviewers stay
 *   readable and the on-screen text never smears together.
 * - ANY focus hides EVERY bubble, this character's included — see the frame loop.
 * - `showBubbles=false` hides them all outright (the caller's phase says the
 *   stage has stopped talking) — same frame loop, independent rule.
 */
function CharacterBubble({
  performer,
  color,
  count,
  viewHeight,
  refDist,
  focused,
  dimmed,
  showBubbles,
  reducedMotion,
}: {
  performer: ScenePerformer;
  color: string;
  count: number;
  viewHeight: number;
  refDist: number;
  focused: boolean;
  dimmed: boolean;
  showBubbles: boolean;
  reducedMotion: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const { status, commentary, score } = performer;

  // Reusable temporaries (avoid per-frame allocation).
  const tmp = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      dir: new THREE.Vector3(),
    }),
    [],
  );
  /** Eased 0..1 fade (opacity) — see the frame loop. */
  const fade = useRef(1);

  // Per-frame: shrink/fade bubbles rotated to the back of the ring so front
  // ones stay legible. Done imperatively on the DOM wrapper (no React churn).
  useFrame((_, dt) => {
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

    /**
     * Keep the bubble a CONSTANT on-screen size, whatever the camera is doing.
     *
     * drei renders `<Html distanceFactor>` at `factor / (2*tan(fov/2)*dist)`,
     * i.e. it scales the DOM like a real 3D object. `distanceFactor` is derived
     * from the rig's RESTING distance, which made on-screen size constant only
     * while the camera stayed on the rig shell — true when `enableZoom={false}`
     * was the only rule, false the moment focus flies the eye in to FOCUS_DIST of
     * a face. Left alone, the focused bubble would render several times oversized
     * and its neighbours 2-3x, i.e. the screen fills with overlapping text exactly
     * when you asked to read ONE reviewer.
     *
     * So divide the perspective back out against the same `refDist` the factor
     * was built from: `factor/(2tan·dist) · (dist/refDist)` = `factor/(2tan·refDist)`
     * — independent of `dist`, exactly the constant the factor always intended.
     *
     * Still exact after FOCUS_DIST moved 3.8 → 7: the identity holds for ANY
     * `dist` and is only broken where the CLAMP bites, and pulling the close-up
     * back moved `comp` at focus from ~0.15 to ~0.27 of `refDist` (≈25.7 at N=3)
     * — i.e. strictly FURTHER from the 0.05 floor. The clamp is a guard against a
     * degenerate camera (eye inside the bubble), not a tuning knob, and nothing in
     * this scene can reach it: the focus eye sits inside the ring, so no bubble is
     * ever nearer than ~3 units or further than ~2x the resting standoff. Note it
     * also makes zoom safe for bubbles if that's ever enabled; fog, being
     * per-fragment off the live camera, was always fine.
     *
     * Depth cueing isn't lost: `readable` already shrinks the back of the ring,
     * and it does it by ROLE (facing the camera or not) rather than by accident
     * of distance.
     */
    const dist = camera.position.distanceTo(tmp.pos);
    const comp = THREE.MathUtils.clamp(dist / refDist, 0.05, 2);

    /**
     * TWO independent reasons to go quiet, OR'd into one damped fade so the
     * bubble leaves the same way whichever fires (and so both firing at once —
     * focus a reviewer during the summary — is not a special case).
     *
     * 1. ANY focus hides EVERY bubble — the focused character's most of all.
     *    `focused || dimmed` is exactly `focusedId != null`, so that half is one
     *    rule, not two: focus in, the stage goes quiet.
     *
     *    The focused bubble used to grow to 1.22x, which was the bug. Its text is
     *    the text the side panel opens to show, so at the one moment the user
     *    asked to READ a reviewer, they got that reviewer's words twice — once in
     *    the panel and once welded over the face the camera had just flown to.
     *    That duplication is the "冗" in the report.
     *
     * 2. `showBubbles=false` — the caller's phase has taken the words elsewhere.
     *    Same principle, one act wider: when the producer's summary panel opens,
     *    it says everything six bubbles were saying, merged and prioritised. Six
     *    stale bubbles behind it are the same duplication at six times the noise,
     *    so the stage hands the text over and keeps only the performance.
     *
     * The panel owns the text; the stage owns the performance; they never say the
     * same thing at the same time.
     */
    const fadeTarget = focused || dimmed || !showBubbles ? 0 : 1;
    fade.current = reducedMotion
      ? fadeTarget
      : THREE.MathUtils.damp(fade.current, fadeTarget, 7, dt);

    // Focus puts the eye INSIDE the ring, so for the first time characters can
    // sit BEHIND the camera — where a projected DOM overlay would smear across
    // the wrong half of the screen. Cheap insurance; the ring-front test above
    // usually catches these too, but only because the focus azimuth happens to
    // track the focused character's.
    camera.getWorldDirection(tmp.dir);
    // tmp.a is spent (the front-ness test is done with it) — reuse, don't alloc.
    const ahead = tmp.a.copy(tmp.pos).sub(camera.position).dot(tmp.dir) > 0.1;

    const opacity = ahead ? (0.12 + readable * 0.88) * fade.current : 0;
    wrap.style.opacity = opacity.toFixed(3);
    wrap.style.transform = `scale(${((0.5 + readable * 0.5) * comp).toFixed(4)})`;
    // `opacity:0` still lays out, paints and hit-tests. Once it's gone, take it
    // off the browser entirely — and off the pointer path well before that, so a
    // bubble the user cannot see never eats a camera drag.
    wrap.style.visibility = opacity < 0.01 ? "hidden" : "visible";
    wrap.style.pointerEvents =
      ahead && readable > 0.5 && fade.current > 0.6 ? "auto" : "none";
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
  const bodyFont = many ? 12.5 : 13.5;
  const bodyMaxH = many ? 96 : 118;
  /**
   * drei `<Html distanceFactor>` renders at `factor / visibleWorldHeight`, so a
   * hard-coded factor silently shrinks the text whenever the camera pulls back or
   * narrows its lens (as the museum rig does). Deriving it from the rig's own
   * `viewHeight` instead makes the whole chain collapse to something you can read
   * off the page: with the `comp` correction above cancelling the live distance,
   * the on-screen CSS scale of a FRONT-facing bubble is EXACTLY this
   * `(base - count*taper)` term — independent of rig distance, fov and viewport.
   *
   * Which is how the old `0.86 - count*0.073` can be shown to have been too small
   * rather than argued about: it put a 3-reviewer bubble on screen at 0.64 scale,
   * i.e. a 12.5px font rendering at 8.0 CSS px (and 4.9px at N=6). CJK needs ~11px
   * to be legible. That was survivable while a side panel carried the text; it is
   * not, now that these bubbles are the only thing the user reads during the argue
   * phase.
   *
   * `1.30 - count*0.11` is the same curve scaled ~1.5x — a deliberate re-scale,
   * not a reset, because what the taper protects is real: the bubble's width
   * against its NEIGHBOUR's. Ring radius and camera standoff both grow with
   * `count`, so adjacent heads land ~402/340/270/223/202 px apart for N=2..6 on a
   * 1440px viewport. The old curve held each bubble at ~40% of that gap; this one
   * holds it at ~60-70%. Visibly bigger, still never touching — "多评审糊成一片"
   * stays fixed. N=6 text does stay small: that is the honest floor of six talkers
   * at museum distance, and the front-ness fade is what makes it survivable by
   * conceding that only the front two are ever meant to be read at once.
   */
  const distanceFactor = viewHeight * (1.3 - Math.min(count, 6) * 0.11);

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
                fontSize: 13,
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
                    fontSize: 13,
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
