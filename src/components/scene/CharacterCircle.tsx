import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Character } from "./Character";
import type { FocusAnchors } from "./focus";
import type { ScenePerformer } from "./ImmersiveScene";

/**
 * Reviewers arranged on a circle, each facing the center — a face-to-face
 * "argument ring" (N=2 → two facing each other; N≥3 → a ring). Radius grows
 * with N so even a wide gesture never overlaps a neighbor. React keys by
 * performer.id, so adding/removing a performer mounts/unmounts exactly one
 * character (its mixer + SkeletonUtils clone included).
 *
 * IMPORTANT — there is exactly ONE source of rotation in this scene: the orbit
 * camera in `SceneCanvas`. The ring group itself is STATIC. It used to spin in
 * a `useFrame` while `PresentationControls` rotated the same content, which
 * meant a user who dragged a reviewer into view had it immediately carried away
 * again by the spin — you could never aim at anybody. The carousel motion now
 * comes from the controller's own `autoRotate`, which the same controller
 * pauses while the user is driving. Never reintroduce a spin here.
 */

/**
 * Radius that keeps adjacent characters apart as the ring grows. Uses the chord
 * rule (min arc-separation `SEP` between neighbours) with a floor, so more
 * reviewers spread onto a visibly wider circle instead of crowding a fixed one
 * (N=3 → roomy, N=6 → wider, never cramped).
 */
export function ringRadius(count: number): number {
  const n = Math.max(count, 2);
  const SEP = 2.3; // desired spacing between adjacent characters
  return Math.max(3.8, SEP / Math.sin(Math.PI / n));
}

/** Vertical FOV of the stage camera. Narrowed from 40° → 34° so the ring reads
 *  as a distant exhibit (less perspective distortion) rather than a wide-angle
 *  "face in your face" shot. */
export const SCENE_FOV = 34;

export interface CameraSetup {
  /** Horizontal (Z) standoff from the ring centre. */
  distH: number;
  /** Camera eye height above the floor. */
  height: number;
  fov: number;
  /** True radial eye→centre distance (drives fog). */
  dist: number;
  /** Visible world height at the ring — the unit head bubbles size against. */
  viewHeight: number;
}

/**
 * Depression angle of the rig: how far ABOVE the ring the eye sits, expressed
 * as a pitch rather than a raw height so it can never drift with N.
 *
 * 22° is the "museum visitor" angle — standing back on the far side of the
 * gallery, looking very slightly down at an exhibit. Below ~20° the far robots
 * stop clearing the near ones (the ring collapses into a wall of bodies); above
 * ~25° it turns into a top-down "looking at their scalps" shot, which is what
 * the previous 35° rig felt like.
 */
export const SCENE_PITCH_DEG = 22;

/**
 * Aim point: the characters' mid-torso. Feet sit at y=-1 and heads top out at
 * y=3.0, so the *body* centre is y≈1.0; the visual centroid is a touch higher
 * because the head bubbles add content above the heads but nothing below the
 * feet. Aiming here centres the composition. (The old y=0.4 was a crutch for
 * the 35° top-down rig — with a near-eye-level camera it just shoves the ring
 * into the top of the frame and leaves dead floor along the bottom.)
 */
export const SCENE_LOOK_AT_Y = 1.2;

/**
 * Museum framing: stand WELL back and look only *slightly* down into the ring.
 *
 * Two independent knobs, deliberately kept separate:
 *
 * 1. DISTANCE controls apparent size. On-screen size ∝ `1 / (dist * tan(fov/2))`,
 *    so pulling back does nothing if you also widen the lens. `distH` (and fov
 *    34) are what fixed the "characters are too big" complaint and are NOT
 *    touched here: distH≈23.8 @ N=3 vs the original ≈15.2.
 * 2. PITCH controls whether you look at faces or at scalps. Deriving `height`
 *    from `distH` via a fixed `SCENE_PITCH_DEG` pins it at 22° for every N,
 *    instead of the old `radius * 1.9 + 9.5` which happened to land at ~35°.
 *    `distH` already scales with radius + count, so `height` inherits exactly
 *    the same adaptivity for free — a wider jury keeps identical framing.
 *
 * Consequence worth knowing: lowering the eye shortens the true radial `dist`
 * (25.7 @ N=3, down from 29.1), so the robots come back up ~13% in size. That's
 * unavoidable geometry at a fixed standoff, and they're still 1.5x further out
 * than the rig the user called "too big". `dist` feeds fog and `viewHeight`,
 * both of which are derived from it and therefore track automatically.
 */
export function cameraSetup(radius: number, count: number): CameraSetup {
  const distH = radius * 2.9 + 11 + count * 0.6;
  const height = distH * Math.tan(THREE.MathUtils.degToRad(SCENE_PITCH_DEG));
  const dist = Math.hypot(distH, height);
  const viewHeight =
    2 * Math.tan(THREE.MathUtils.degToRad(SCENE_FOV) / 2) * dist;
  return { distH, height, fov: SCENE_FOV, dist, viewHeight };
}

/**
 * Polar window (angle from +Y) the orbit camera may travel through.
 *
 * The rig's resting polar is ~70° — that is `SCENE_PITCH_DEG` (22° of
 * depression measured off the FLOOR, i.e. polar 68°) plus the couple of degrees
 * the `SCENE_LOOK_AT_Y` torso-height target adds, since polar is measured from
 * the orbit target and not from the origin. It lands at ~70.5° for N=3 and
 * ~70.1° for N=6 — the distH formula keeps it flat across N by construction.
 *
 * ±15° of headroom around that: 55° is a mild high-angle shot, 85° is nearly
 * eye level with the ring. Outside this window you either look at scalps (the
 * old 35° rig the user rejected) or clip through the floor.
 */
export const SCENE_POLAR_MIN = THREE.MathUtils.degToRad(55);
export const SCENE_POLAR_MAX = THREE.MathUtils.degToRad(85);

/**
 * Focus close-up: how far the eye sits from the FACE, and how far above it.
 *
 * 7 units, up from 3.8, and the number is DERIVED, not dialled. At fov 34 the
 * visible world height at distance d is `2*tan(17°)*d = 0.611*d`, and this cast's
 * head — measured, neck joint to crown, after Character.tsx normalises every body
 * to TARGET_HEIGHT — is 1.71 (Skeleton) to 1.86 (Knight) units tall:
 *
 *   d=3.8 → 2.32 units of frame → the head ALONE fills 80% of the height, and the
 *           visible band (y≈0.8…3.2 around a face at y≈2.0) crops every hat. That
 *           is a nostril shot, and it is the "镜头有点近" the user rejected.
 *   d=7.0 → 4.28 units of frame → the head is ~43% of it, and the band runs
 *           y≈-0.1…4.2: head, shoulders and chest, with air above the crown.
 *           A portrait with somewhere to breathe.
 *
 * Pulling back is also what pays for the lateral truck below: the subject has to
 * fit in the free RIGHT ~60% of the width, so the usable frame is 0.6x. At 3.8 the
 * head would simply not fit in that band; at 7 it sits in it with margin.
 *
 * 12° of depression = polar 78°, comfortably inside [SCENE_POLAR_MIN,
 * SCENE_POLAR_MAX], so the controller never clamps the focus pose out from under
 * us and the user keeps ~7° of headroom to drag into. Deliberately UNCHANGED:
 * distance and pitch are independent knobs and only distance was wrong.
 */
export const FOCUS_DIST = 7;
export const FOCUS_PITCH_DEG = 12;

/**
 * Where the focused face should land horizontally, in NDC x (0 = centre, +1 =
 * right edge). While focused the UI panel owns the LEFT ~40% of the viewport, so
 * a centred subject is a subject BEHIND the panel — the user's "UI 会挡住那个人脸".
 *
 * 0.3 → viewport x = (1 + 0.3)/2 = 65%, the middle of the free right-hand 60%.
 *
 * Delivered as a camera TRUCK, never a character move: `controls.target` and the
 * eye are displaced by the SAME world vector along the camera's right axis, so
 * the view direction is bit-for-bit unchanged and only the subject's screen
 * position moves. Displacing the character instead would corrupt the ring itself
 * (radius, inward facing, neighbour spacing) to solve a purely photographic
 * problem — and would drag the other five characters' geometry with it.
 *
 * The world displacement is derived from the frustum, never a pixel constant:
 *
 *   k = FOCUS_DIST * tan(fov/2) * aspect * FOCUS_SHIFT_NDC
 *
 * `FOCUS_DIST * tan(fov/2) * aspect` is the frustum half-width at the face's
 * depth, and the face stays at exactly `FOCUS_DIST` deep because the truck is
 * perpendicular to the view axis — so its size, and the vertical framing, are
 * untouched. Displace by `-right * k`: the TARGET goes left of the face, which
 * throws the FACE right.
 */
export const FOCUS_SHIFT_NDC = 0.3;

/**
 * Narrow-viewport ramp. `k` already shrinks with `aspect`, but the NDC landing
 * spot does NOT: on a portrait phone, 65% of a narrow frame still shoves the
 * shoulders off the right edge — and there the panel is not a left-hand 40%
 * column anyway, so there is nothing to duck. Ramp the offset out below 1.5:1 and
 * off entirely at 0.95:1 (square).
 */
const FOCUS_SHIFT_ASPECT_OFF = 0.95;
const FOCUS_SHIFT_ASPECT_FULL = 1.5;

/**
 * Half-width of a chibi head+shoulders in world units (measured cast ≈ 0.9; 1.0
 * with a margin). Used for a hard cap, so that whatever the aspect ramp and the
 * NDC constant are ever retuned to, the subject's own silhouette can never be
 * trucked past the right edge. Insurance, not a tuning knob.
 */
const FOCUS_SUBJECT_HALF_W = 1;

/** Frustum half-width at FOCUS_DIST, per unit of aspect. */
const FOCUS_HALF_W = FOCUS_DIST * Math.tan(THREE.MathUtils.degToRad(SCENE_FOV) / 2);

/** NDC x the focused face is trucked to for this viewport aspect (0 = centred). */
export function focusShiftNdc(aspect: number): number {
  const ramp = THREE.MathUtils.smoothstep(
    aspect,
    FOCUS_SHIFT_ASPECT_OFF,
    FOCUS_SHIFT_ASPECT_FULL,
  );
  if (ramp <= 0) return 0;
  const halfW = FOCUS_HALF_W * aspect;
  // Room left over once the subject's own silhouette is accounted for.
  const room = Math.max(0, 0.98 - FOCUS_SUBJECT_HALF_W / halfW);
  return Math.min(FOCUS_SHIFT_NDC * ramp, room);
}

/**
 * Ease rates, as `THREE.MathUtils.damp` lambdas. Exponential ease-out, which is
 * the standard camera feel, and — unlike a start→end tween over a fixed
 * duration — it re-reads the LIVE camera every frame. That matters: a user who
 * drags mid-flight blends with the move instead of having it stomped back onto a
 * path captured a second ago. The stated "duration" is the 95% settle time
 * (`3/λ`); the residual is sub-pixel.
 *
 *   FRAME 3.4 → 0.88s  (focus in, fly back to panorama, N-change restandoff)
 *   INTRO 2.2 → 1.36s  (opening move)
 */
const LAMBDA_FRAME = 3.4;
const LAMBDA_INTRO = 2.2;

/** Opening move: start this much further out and this much higher, then settle. */
const INTRO_PULL = 1.4;
const INTRO_LIFT = THREE.MathUtils.degToRad(13);

/**
 * Reveal beat: a single ~4% lens punch-in and back out when the whole jury has
 * finished. Deliberately the LENS and not the rig — see the note on `revealKey`.
 */
const REVEAL_MS = 380;
const REVEAL_FOV_DELTA = 1.4;

/** The bit of an OrbitControls we touch. r3f types `state.controls` as a bare
 *  `THREE.EventDispatcher`, so this is the structural contract we cast to. */
interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * A pose the rig is easing toward, expressed the way OrbitControls thinks:
 * an orbit `target` plus spherical offset. Never a raw camera position — the
 * controller re-derives its spherical from wherever we put the camera, so
 * speaking its language is what keeps the two from fighting.
 */
interface Goal {
  target: THREE.Vector3;
  r: number;
  phi: number;
  /**
   * null → PRESERVE the current azimuth.
   *
   * This is the whole no-fight rule in one field. Azimuth is the axis both
   * `autoRotate` and the user's drag live on, so the rig only ever claims it for
   * a focus (where autoRotate is provably off, since `focusedId` gates it). Every
   * other move — intro, fly-back, restandoff — leaves it alone, which also means
   * a restandoff can't yank whoever the user is currently looking at out of frame.
   */
  theta: number | null;
  lambda: number;
}

const _offset = new THREE.Vector3();
const _spherical = new THREE.Spherical();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Shortest signed arc from b to a, so theta easing never takes the long way. */
function angleDelta(a: number, b: number): number {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** The resting museum pose, as a Goal. */
function panoramaGoal(radius: number, count: number): Omit<Goal, "lambda"> {
  const { distH, height } = cameraSetup(radius, count);
  const vy = height - SCENE_LOOK_AT_Y;
  return {
    target: new THREE.Vector3(0, SCENE_LOOK_AT_Y, 0),
    r: Math.hypot(distH, vy),
    phi: Math.atan2(distH, vy),
    theta: null,
  };
}

/**
 * Close-up on a character's face, derived entirely from its published anchor.
 *
 * The eye goes along the character's own FORWARD from its face — read off the
 * anchor's world quaternion (the models' +Z is their forward; the anchor
 * inherits the ring group's yaw and nothing else). Deliberately not "toward the
 * ring centre": that happens to be the same thing for N≥2, but it degenerates at
 * N≤1 where the lone character stands ON the centre and there is no radial
 * direction to speak of.
 *
 * Consequence worth expecting: everyone faces inward, so focusing the character
 * nearest the default camera is a ~180° swoop INTO the ring — you're behind them
 * and their face is on the far side. That's geometry, not a bug.
 *
 * `aspect` drives the lateral truck that keeps the face clear of the UI panel —
 * see FOCUS_SHIFT_NDC. It is the ONLY reason this function needs a viewport.
 */
function focusGoal(anchor: THREE.Object3D, aspect: number): Omit<Goal, "lambda"> {
  anchor.updateWorldMatrix(true, false);
  const target = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld);
  anchor.getWorldQuaternion(_q);
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
  _fwd.normalize();

  const pitch = THREE.MathUtils.degToRad(FOCUS_PITCH_DEG);
  _offset
    .copy(_fwd)
    .multiplyScalar(FOCUS_DIST * Math.cos(pitch))
    .setY(FOCUS_DIST * Math.sin(pitch));
  // Read the spherical BEFORE trucking: `r/phi/theta` describe the eye RELATIVE
  // to the target, and the truck moves both by the same vector — so the orbit is
  // untouched by construction and the camera's orientation cannot drift with it.
  _spherical.setFromVector3(_offset);

  const ndc = focusShiftNdc(aspect);
  if (ndc > 1e-4) {
    // Camera right = normalize(cross(viewDir, worldUp)). The cross against
    // (0,1,0) annihilates viewDir's Y, so `right` depends only on the HORIZONTAL
    // view direction (-_fwd) and the 12° depression drops out: right = (fz,0,-fx).
    _right.set(_fwd.z, 0, -_fwd.x);
    target.addScaledVector(_right, -(FOCUS_HALF_W * aspect * ndc));
  }
  return { target, r: _spherical.radius, phi: _spherical.phi, theta: _spherical.theta };
}

export function CameraRig({
  radius,
  count,
  focusedId,
  anchors,
  anchorEpoch,
  revealKey,
  reducedMotion,
  onCinematic,
}: {
  radius: number;
  count: number;
  /** Already validated against the performer list by SceneCanvas. */
  focusedId: string | null;
  anchors: FocusAnchors;
  /** Bumped whenever a character (un)publishes its anchor — see focus.ts. */
  anchorEpoch: number;
  /** Bumped once when the whole jury lands on a terminal status. */
  revealKey: number;
  reducedMotion: boolean;
  /** Fires true while a scripted move owns the camera, false when it lands. */
  onCinematic: (flying: boolean) => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const size = useThree((s) => s.size);
  /**
   * Viewport aspect, but COLLAPSED TO 0 when nothing is focused.
   *
   * The close-up's lateral truck is derived from the aspect, so a resize (or a
   * phone rotating past the narrow-viewport ramp) must re-frame it — hence it has
   * to be a dependency of the goal effect below. But the PANORAMA has no aspect
   * term at all, and letting a resize re-issue it would `go(panoramaGoal)` and
   * drag a user's own orbit back to the default pitch every time a window edge
   * moves. Pinning the dep to a constant while unfocused is what keeps the resize
   * reaction scoped to the only pose that actually reads it — and inside the focus
   * branch this IS the live aspect, so nothing is lost.
   */
  const focusAspect = focusedId ? size.width / Math.max(size.height, 1) : 0;
  /** Non-null only while easing. Null = OrbitControls has sole ownership. */
  const goal = useRef<Goal | null>(null);
  const placed = useRef(false);
  const cinematic = useRef(false);
  const baseFov = useRef(SCENE_FOV);
  /** Elapsed ms of the reveal lens beat, or null when idle. */
  const breath = useRef<number | null>(null);
  const lastReveal = useRef(revealKey);

  const setCinematic = useCallback(
    (v: boolean) => {
      if (cinematic.current === v) return;
      cinematic.current = v;
      onCinematic(v);
    },
    [onCinematic],
  );

  /**
   * Start easing toward `g` — or, under reduced-motion, BE there this instant.
   * Every camera move in this component goes through here, so the accessibility
   * branch is impossible to forget on a later addition.
   */
  const go = useCallback(
    (g: Omit<Goal, "lambda">, lambda: number) => {
      if (!controls) return;
      _offset.copy(camera.position).sub(controls.target);
      _spherical.setFromVector3(_offset);
      const theta = g.theta ?? _spherical.theta;

      // Already framed (a re-run from an epoch bump, a no-op restandoff, …).
      // Bail before announcing a flight nobody would see.
      const there =
        controls.target.distanceToSquared(g.target) < 1e-4 &&
        Math.abs(_spherical.radius - g.r) < 0.02 &&
        Math.abs(_spherical.phi - g.phi) < 0.002 &&
        Math.abs(angleDelta(theta, _spherical.theta)) < 0.002;

      if (there || reducedMotion) {
        controls.target.copy(g.target);
        _spherical.set(g.r, g.phi, theta);
        _spherical.makeSafe();
        camera.position.copy(controls.target).add(_v.setFromSpherical(_spherical));
        controls.update();
        goal.current = null;
        setCinematic(false);
        return;
      }
      goal.current = { ...g, lambda };
      setCinematic(true);
    },
    [camera, controls, reducedMotion, setCinematic],
  );

  /**
   * THE ONLY PLACE that issues camera goals. Deliberately one effect and not
   * three (mount / focus / restandoff): with several writers racing for
   * `goal.current`, "who wins when N changes while focused" becomes an ordering
   * accident. Here the priority is stated once, top to bottom.
   */
  useEffect(() => {
    if (!controls) return;
    const { distH, height, fov } = cameraSetup(radius, count);
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    baseFov.current = fov;

    const first = !placed.current;
    if (first) {
      placed.current = true;
      // Aim at mid-torso so the ring sits centred vertically: content spans
      // y=-1 (feet) to ~y=3 (bubbles above heads), and the eye is only 22° up.
      controls.target.set(0, SCENE_LOOK_AT_Y, 0);
      camera.position.set(0, height, distH);
      controls.update();
      goal.current = null;
    }

    // 1. Focus wins over everything. If the character exists but hasn't mounted
    //    yet (Suspense still fetching its GLB) there's no anchor to aim at —
    //    leave the camera ALONE and wait. `anchorEpoch` is what re-runs us the
    //    moment it registers; falling through to panorama here would instead
    //    look like "the focus was ignored".
    if (focusedId) {
      const anchor = anchors.get(focusedId);
      if (anchor) go(focusGoal(anchor, focusAspect), LAMBDA_FRAME);
      return;
    }

    const p = panoramaGoal(radius, count);

    // 2. Opening move, once. The camera is already ON the museum pose (above),
    //    so displace it out/up and fly back down into frame. Under
    //    reduced-motion we simply stay put — the pose is already correct.
    if (first) {
      if (reducedMotion) {
        setCinematic(false);
        return;
      }
      // theta 0: we hard-set the camera to (0, height, distH) two lines up, so
      // the opening azimuth IS 0 (facing the i=0 reviewer) by construction.
      // Clamped off SCENE_POLAR_MIN because the controller would clamp it anyway
      // — better to fly from the pose we actually asked for.
      _spherical.set(
        p.r * INTRO_PULL,
        Math.max(p.phi - INTRO_LIFT, SCENE_POLAR_MIN + 0.02),
        0,
      );
      camera.position.copy(controls.target).add(_v.setFromSpherical(_spherical));
      controls.update();
      go(p, LAMBDA_INTRO);
      return;
    }

    // 3. Focus released, or N changed → (re)frame the panorama, azimuth intact.
    go(p, LAMBDA_FRAME);
  }, [
    camera,
    controls,
    radius,
    count,
    focusedId,
    focusAspect,
    anchors,
    anchorEpoch,
    reducedMotion,
    go,
    setCinematic,
  ]);

  // Reveal beat. Fired off a KEY rather than a boolean so it's a one-shot: a
  // later focus change must not re-punch the lens.
  useEffect(() => {
    if (revealKey === lastReveal.current) return;
    lastReveal.current = revealKey;
    // Never stack it on another move: reduced-motion, mid-flight, or focused
    // (the close-up IS the beat) all decline. Restraint over spectacle.
    if (reducedMotion || goal.current || focusedId) return;
    breath.current = 0;
  }, [revealKey, reducedMotion, focusedId]);

  // Priority -2 so this lands BEFORE drei's OrbitControls update (-1): we move
  // the camera, then the controller reads that position in the same frame and
  // re-derives its spherical + orientation from it. One update per frame, no
  // double-damping, no one-frame lag on the lookAt. (Negative priorities do not
  // take over r3f's render loop; only positive ones do.)
  useFrame((_, dt) => {
    const g = goal.current;
    if (g && controls) {
      // `damp`'s own blend factor, shared by target/r/phi/theta so they arrive
      // together and the path stays a single smooth swoop.
      const k = 1 - Math.exp(-g.lambda * dt);

      controls.target.lerp(g.target, k);
      // Read the offset against the ALREADY-eased target: target and orbit are
      // one move, not two stacked ones.
      _offset.copy(camera.position).sub(controls.target);
      _spherical.setFromVector3(_offset);

      const r = THREE.MathUtils.lerp(_spherical.radius, g.r, k);
      const phi = THREE.MathUtils.lerp(_spherical.phi, g.phi, k);
      const theta =
        g.theta == null
          ? _spherical.theta
          : _spherical.theta + angleDelta(g.theta, _spherical.theta) * k;

      const arrived =
        controls.target.distanceToSquared(g.target) < 1e-4 &&
        Math.abs(r - g.r) < 0.01 &&
        Math.abs(phi - g.phi) < 0.001 &&
        (g.theta == null || Math.abs(angleDelta(theta, g.theta)) < 0.001);

      if (arrived) {
        controls.target.copy(g.target);
        _spherical.set(g.r, g.phi, g.theta ?? theta);
        goal.current = null;
      } else {
        _spherical.set(r, phi, theta);
      }
      _spherical.makeSafe();
      camera.position.copy(controls.target).add(_v.setFromSpherical(_spherical));
      // Announce AFTER the last write, so the frame the spin is allowed to
      // resume on is a frame we are no longer touching.
      if (arrived) setCinematic(false);
    }

    // The lens beat is orthogonal to the rig: OrbitControls owns position and
    // target, never fov, so this can run alongside a flight without contention.
    const t = breath.current;
    if (t != null) {
      if (!(camera instanceof THREE.PerspectiveCamera)) {
        breath.current = null;
      } else {
        const nt = t + dt * 1000;
        const p = Math.min(nt / REVEAL_MS, 1);
        // sin(πp): in and back out in one beat, guaranteed to land on baseFov.
        camera.fov = baseFov.current - REVEAL_FOV_DELTA * Math.sin(Math.PI * p);
        camera.updateProjectionMatrix();
        breath.current = p >= 1 ? null : nt;
      }
    }
  }, -2);

  return null;
}

export function CharacterCircle({
  performers,
  focusedId,
  anchors,
  showBubbles,
  reducedMotion,
}: {
  performers: ScenePerformer[];
  focusedId: string | null;
  anchors: FocusAnchors;
  /** Master switch for every head bubble — see ImmersiveScene. */
  showBubbles: boolean;
  reducedMotion: boolean;
}) {
  const N = performers.length;
  const R = ringRadius(N);
  const { viewHeight, dist } = cameraSetup(R, N);

  return (
    <group>
      {performers.map((p, i) => {
        // i=0 starts at the front (+Z); evenly spaced around the circle.
        const angle = N <= 1 ? 0 : (i / N) * Math.PI * 2;
        const x = Math.sin(angle) * (N <= 1 ? 0 : R);
        const z = Math.cos(angle) * (N <= 1 ? 0 : R);
        // Face the center: yaw = angle + π rotates the model's +Z toward origin.
        // The KayKit models keep this assumption: their root `Rig` carries no
        // rotation and forward IS +Z (verified from the meshes — the skeleton's
        // eyes/jaw sit at +Z while every cape hangs at -Z). So no π correction.
        const rotY = angle + Math.PI;
        return (
          <group key={p.id} position={[x, 0, z]} rotation={[0, rotY, 0]}>
            {/* NOTE: `index` is deliberately NOT forwarded. Ring placement is
                positional, but animation variation and the character choice must
                be derived from the stable performer.id — otherwise deleting one
                renumbers its neighbours and re-triggers their state machines. */}
            <Character
              performer={p}
              count={N}
              viewHeight={viewHeight}
              refDist={dist}
              anchors={anchors}
              focused={focusedId === p.id}
              dimmed={focusedId != null && focusedId !== p.id}
              showBubbles={showBubbles}
              reducedMotion={reducedMotion}
            />
          </group>
        );
      })}
    </group>
  );
}
