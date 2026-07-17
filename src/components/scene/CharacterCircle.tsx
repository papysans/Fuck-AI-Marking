import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Character } from "./Character";
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

/** The bit of an OrbitControls we touch. r3f types `state.controls` as a bare
 *  `THREE.EventDispatcher`, so this is the structural contract we cast to. */
interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

const _offset = new THREE.Vector3();
const _spherical = new THREE.Spherical();

export function CameraRig({
  radius,
  count,
}: {
  radius: number;
  count: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree(
    (s) => s.controls,
  ) as unknown as OrbitLike | null;
  /** Non-null only while easing to a new standoff after N changed. */
  const goal = useRef<{ r: number; phi: number } | null>(null);
  const placed = useRef(false);

  // The rig POSES the camera; it does not DRIVE it. Once placed, OrbitControls
  // owns camera.position/quaternion every frame — so this must never write the
  // camera again except when the framing inputs (radius/count) actually change,
  // otherwise it would fight the controller and stomp the user's drag.
  useEffect(() => {
    if (!controls) return;
    const { distH, height, fov } = cameraSetup(radius, count);
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Aim at mid-torso so the ring sits centred vertically: content spans
    // y=-1 (feet) to ~y=3 (bubbles above heads), and the eye is only 22° up.
    controls.target.set(0, SCENE_LOOK_AT_Y, 0);

    if (!placed.current) {
      // First mount: hard-set the exact museum pose (azimuth 0 = facing the
      // i=0 reviewer), then hand the camera over.
      camera.position.set(0, height, distH);
      controls.update();
      placed.current = true;
      goal.current = null;
      return;
    }
    // N changed → the ring needs a new standoff. Ease radius/polar toward it
    // and leave AZIMUTH ALONE: snapping back to the front would yank whoever
    // the user is currently looking at out of frame.
    const vy = height - SCENE_LOOK_AT_Y;
    goal.current = { r: Math.hypot(distH, vy), phi: Math.atan2(distH, vy) };
  }, [camera, controls, radius, count]);

  // Priority -2 so this lands BEFORE drei's OrbitControls update (-1): we move
  // the camera, then the controller reads that position in the same frame and
  // re-derives its spherical + orientation from it. One update per frame, no
  // double-damping, no one-frame lag on the lookAt. (Negative priorities do not
  // take over r3f's render loop; only positive ones do.)
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    _offset.copy(camera.position).sub(controls.target);
    _spherical.setFromVector3(_offset);
    const r = THREE.MathUtils.damp(_spherical.radius, g.r, 3, dt);
    const phi = THREE.MathUtils.damp(_spherical.phi, g.phi, 3, dt);
    if (Math.abs(r - g.r) < 0.01 && Math.abs(phi - g.phi) < 0.001) {
      _spherical.radius = g.r;
      _spherical.phi = g.phi;
      goal.current = null;
    } else {
      _spherical.radius = r;
      _spherical.phi = phi;
    }
    camera.position
      .copy(controls.target)
      .add(_offset.setFromSpherical(_spherical));
  }, -2);

  return null;
}

export function CharacterCircle({
  performers,
  reducedMotion,
}: {
  performers: ScenePerformer[];
  reducedMotion: boolean;
}) {
  const N = performers.length;
  const R = ringRadius(N);
  const { viewHeight } = cameraSetup(R, N);

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
              reducedMotion={reducedMotion}
            />
          </group>
        );
      })}
    </group>
  );
}
