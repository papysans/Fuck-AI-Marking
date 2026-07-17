import * as THREE from "three";

/**
 * The KayKit (CC0) cast + everything that depends on the SPECIFIC quirks of
 * those GLBs: which clips exist, which are static poses, which meshes are
 * duplicate equipment, and how to normalise wildly different model scales.
 *
 * All facts below were measured from the actual files in `public/models`, not
 * assumed — see the notes on each constant. Keep this module free of React so
 * the rules stay unit-testable and the component stays about lifecycle.
 */

export interface CharacterDef {
  id: string;
  url: string;
  /**
   * KayKit ships EVERY weapon variant in one file with `visible: true`, so a
   * naive render gives the Knight two swords and four overlapping shields at
   * once. We hide everything parented under a `handslot*` bone; set `equip` to
   * a mesh name to keep exactly one item (e.g. "2H_Staff" for the Mage).
   */
  equip?: string;
}

/** The four evaluators. Order is stable — `characterFor` indexes into it. */
export const CHARACTERS: readonly CharacterDef[] = [
  { id: "knight", url: "/models/Knight.glb" },
  { id: "mage", url: "/models/Mage.glb" },
  { id: "barbarian", url: "/models/Barbarian.glb" },
  { id: "skeleton", url: "/models/Skeleton_Warrior.glb" },
] as const;

/**
 * FNV-1a — a stable per-id variation seed.
 *
 * Deliberately NOT the array index: indices shift when a reviewer is deleted
 * from the middle of the list, which would re-run every surviving performer's
 * animation effect and re-roll its pose/timeScale mid-performance.
 */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic character per reviewer, derived from the id and NOTHING else
 * (not the ring index, not the accent slot) so a performer keeps its body when
 * neighbours are added/removed. Salted with a suffix so the choice doesn't
 * correlate with the pose/timeScale variation that also reads `seedOf(id)`.
 *
 * Collisions are expected and fine: >4 reviewers must reuse bodies, and each
 * instance gets its own `SkeletonUtils.clone` anyway.
 */
export function characterFor(performerId: string): CharacterDef {
  return CHARACTERS[seedOf(`${performerId}@character`) % CHARACTERS.length];
}

/**
 * Static single-frame poses masquerading as clips. Playing one on a loop welds
 * the character into a T shape / leaves it lying down forever, so they are
 * filtered out of every candidate list.
 *
 * Measured names include: `T-Pose`, `Death_A_Pose`, `Death_C_Pose`, `Lie_Pose`,
 * `Unarmed_Pose`, `Sit_Chair_Pose`, `Sit_Floor_Pose`,
 * `Skeleton_Inactive_Standing_Pose`, `Skeletons_Inactive_Floor_Pose`.
 * Note `T-Pose` uses a hyphen, so a bare `/_Pose$/` would MISS it.
 */
export function isPlayableClip(name: string): boolean {
  return name !== "T-Pose" && !name.endsWith("_Pose");
}

/**
 * Candidate lists, best first. Resolved against each model's ACTUAL clip list,
 * so a name missing from a given character simply falls through instead of
 * producing an `undefined` action.
 */
const PENDING_CANDIDATES = ["Idle", "Unarmed_Idle"];

/**
 * "Arguing" gestures. `Taunt`/`Taunt_Longer` exist ONLY on Skeleton_Warrior
 * (95 clips vs 76) — listing them here is safe precisely because resolution is
 * availability-driven: the skeleton picks up two extra jeers, the others don't.
 */
const STREAM_CANDIDATES = [
  "Spellcasting",
  "Spellcast_Raise",
  "Interact",
  "Throw",
  "Unarmed_Melee_Attack_Punch_A",
  "Unarmed_Melee_Attack_Punch_B",
  "Block_Attack",
  "Taunt",
  "Taunt_Longer",
];

const WIN_CANDIDATES = ["Cheer", "Jump_Full_Short"];
const LOSE_CANDIDATES = ["Death_A", "Death_B"];
const ERROR_CANDIDATES = ["Hit_A", "Hit_B"];

/**
 * One-shot "the camera is on ME" gesture, played when a character is focused.
 *
 * Verified against the real clip lists, NOT assumed: `Yes` does not exist on any
 * of the four models, and `Taunt` exists ONLY on Skeleton_Warrior (95 clips vs
 * 76) — so in practice the skeleton jeers and everyone else throws the
 * big raised-arm `Spellcast_Raise`. Same availability-driven resolution as every
 * other slot, so a missing name just falls through.
 *
 * Deliberately NO fallback to `pending`: firing `Idle` once as a "look at me"
 * gesture is a no-op that would only fight the state machine. `null` → the
 * caller skips the gesture entirely.
 */
const FOCUS_CANDIDATES = ["Taunt", "Spellcast_Raise", "Interact", "Cheer"];

export interface AnimationPlan {
  pending: string | null;
  /** Non-empty whenever anything is playable; cycled while streaming. */
  stream: string[];
  win: string | null;
  lose: string | null;
  error: string | null;
  /** One-shot focus gesture, or null if this model has none worth playing. */
  focus: string | null;
}

function firstAvailable(candidates: string[], have: Set<string>): string | null {
  return candidates.find((n) => have.has(n)) ?? null;
}

/**
 * Resolve the state machine against a model's real clips. Every slot degrades
 * gracefully: specific clip → `Idle` → first playable clip → `null` (caller
 * must skip). Nothing here can hand the mixer a name it doesn't own.
 */
export function planFor(animations: THREE.AnimationClip[]): AnimationPlan {
  const have = new Set(
    animations.map((c) => c.name).filter((n) => isPlayableClip(n)),
  );

  const pending =
    firstAvailable(PENDING_CANDIDATES, have) ??
    // last resort: any playable clip at all, in the file's own order
    animations.map((c) => c.name).find((n) => have.has(n)) ??
    null;

  const stream = STREAM_CANDIDATES.filter((n) => have.has(n));

  return {
    pending,
    stream: stream.length > 0 ? stream : pending ? [pending] : [],
    win: firstAvailable(WIN_CANDIDATES, have) ?? pending,
    lose: firstAvailable(LOSE_CANDIDATES, have) ?? pending,
    error: firstAvailable(ERROR_CANDIDATES, have) ?? pending,
    focus: firstAvailable(FOCUS_CANDIDATES, have),
  };
}

/**
 * Duck-typed guards instead of `instanceof THREE.Mesh`.
 *
 * `instanceof` silently breaks whenever two copies of three end up in the same
 * process (ESM + CJS resolution, a duplicated transitive dep, a test runner
 * transpiling this file differently than its caller): the check returns false
 * for EVERY mesh, so tinting/hiding/measuring all no-op and the model renders
 * unscaled with no error. three sets these boolean brands for exactly this
 * reason, so they hold across module instances.
 */
function asMesh(obj: THREE.Object3D): THREE.Mesh | null {
  return (obj as THREE.Mesh).isMesh ? (obj as THREE.Mesh) : null;
}

function asStandardMaterial(mat: THREE.Material): THREE.MeshStandardMaterial | null {
  return (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (mat as THREE.MeshStandardMaterial)
    : null;
}

/** True if `obj` sits under a `handslot*` bone (i.e. it is swappable equipment). */
function inHandSlot(obj: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = obj; p; p = p.parent) {
    if (/^handslot/i.test(p.name)) return true;
  }
  return false;
}

export interface FitResult {
  /** Uniform scale that brings the model to `targetHeight`. */
  scale: number;
  /** Y position that drops the (scaled) feet exactly onto `groundY`. */
  y: number;
  /**
   * Every material this character renders with, all of them PRIVATE to this
   * instance — safe to mutate per frame (see the focus fade in Character.tsx).
   * See `prepareCharacter` for why ownership is not optional here.
   */
  materials: THREE.Material[];
  /**
   * Height of the MEASURED `head` joint, in the character group's space (i.e.
   * already scaled and grounded — the same space `y` is in). This is the neck
   * pivot, not the face: see HEAD_JOINT.
   */
  headY: number;
  /** Height of the measured crown (top of the body box), same space as `headY`. */
  topY: number;
}

/**
 * The joint every one of the four rigs hangs its head off:
 * `Rig/root/hips/spine/chest/head`. Verified present, and a real skin joint, in
 * all four GLBs.
 *
 * Two things worth knowing before you use it as a camera target:
 *
 * 1. It sits at bind-local y=1.2414 on ALL four models (they share one KayKit
 *    skeleton) — but the models are authored at different BODY heights (2.17 to
 *    2.32), so each gets a different normalisation scale and the joint lands at a
 *    different world height per character. Hence: measure, never hardcode.
 * 2. It is the NECK PIVOT, not the face. This cast is chibi — the head spans
 *    from the joint (1.2414) to the crown (~2.2-2.32), i.e. ~46% of the whole
 *    body. Aiming a close-up at the joint would frame the chin. Callers should
 *    lerp between `headY` and `topY` to find the face.
 */
const HEAD_JOINT = "head";

/**
 * Where the FACE is, as a blend from the measured neck joint (`headY`, 0) to the
 * measured crown (`topY`, 1). 0.45 lands just under the eyes on this cast.
 *
 * Both ENDS are measured per-model; only this blend is authored — which is the
 * point: the number stays valid if the models, TARGET_HEIGHT or MEASURE_BASIS
 * ever change, because it's a proportion of a measured head rather than a world
 * height. Lives here, next to the measurement that defines its endpoints.
 */
export const FACE_LIFT = 0.45;

/**
 * What "same height" means — a real trade-off, because the four models differ
 * almost ENTIRELY in headgear, not in body. Measured bind-pose heights:
 *
 *              full (incl. hat)   body only (skinned meshes)
 *   Knight           2.47                  2.32
 *   Mage             3.00                  2.20   ← hat alone is ~1.6 units
 *   Barbarian        2.40                  2.19
 *   Skeleton         2.59                  2.17
 *
 * - `"silhouette"` (default): every character occupies exactly `targetHeight`
 *   and all four TOPS line up. Cost: the Mage's giant hat eats his budget, so
 *   his body ends up ~22% shorter than the Knight's — a small wizard in a big
 *   hat.
 * - `"body"`: the PEOPLE match (bodies already agree within ~7%) and hats stick
 *   up naturally. Cost: total silhouettes differ (the Mage stands ~28% taller
 *   overall).
 *
 * Flip the constant in `Character.tsx` to switch; both keep the feet grounded.
 */
export type MeasureBasis = "silhouette" | "body";

/**
 * Hide duplicate equipment, tint, and MEASURE the model so every character ends
 * up the same height with its feet on the floor.
 *
 * Why measure instead of hardcoding: the four models are authored at different
 * scales (measured full heights — Knight 2.47, Mage 3.00, Barbarian 2.40,
 * Skeleton 2.59; the Mage is tall only because of his hat). Feet DO sit at
 * y≈0 on all four, but we still derive the drop from the measured `min.y`
 * rather than trusting that.
 *
 * Measurement details that matter:
 * - `Box3.expandByObject` does NOT skip invisible meshes, so we union manually
 *   over visible meshes only — otherwise the hidden weapons would count.
 * - We use each mesh's GEOMETRY bbox × its world matrix. For a SkinnedMesh,
 *   `Box3.setFromObject` prefers `object.boundingBox`, which is skinned at the
 *   CURRENT pose and would make normalisation depend on the animation frame.
 *   Geometry bbox is bind-pose, hence stable and pose-independent.
 * - Must run while the clone is still in bind pose (before the mixer touches it).
 */
export function prepareCharacter(
  clone: THREE.Object3D,
  opts: {
    def: CharacterDef;
    /** Reviewer voice colour, applied only to untextured materials. */
    accent: string;
    targetHeight: number;
    groundY: number;
    basis?: MeasureBasis;
  },
): FitResult {
  const { def, accent, targetHeight, groundY, basis = "silhouette" } = opts;

  /**
   * Source material → this instance's private copy.
   *
   * EVERY material is cloned now, not just the ones we tint. `SkeletonUtils.clone`
   * shares materials with the source scene AND therefore with every other clone of
   * it, and `useGLTF` caches that scene — so two reviewers who happen to roll the
   * same body (guaranteed above 4 reviewers, since the cast is 4) render with the
   * SAME material object. That was invisible while materials were only read, but
   * the focus fade WRITES `opacity`/`transparent` per character: shared materials
   * would mean dimming one reviewer also dims the reviewer wearing the same body.
   * Ownership is what makes the fade addressable at all.
   *
   * Keyed by source so meshes sharing a material inside ONE model keep sharing a
   * single copy (fewer uniform uploads, and the fade stays one write per material
   * rather than one per mesh).
   *
   * Cost is bounded and cheap: a clone keeps the same `map` texture reference (no
   * re-upload) and the same program cache key, so three hands back the SAME
   * compiled program — no extra shader compiles, just a few more uniform sets.
   * Not disposed, matching this module's existing convention: the copies are
   * plain garbage once the clone is dropped, and the programs they refcount are
   * shared with the characters still on stage.
   */
  const owned = new Map<THREE.Material, THREE.Material>();
  const ownMaterial = (mat: THREE.Material): THREE.Material => {
    const cached = owned.get(mat);
    if (cached) return cached;
    const copy = mat.clone();
    // Tint. KayKit bodies use ONE atlas texture (`knight_texture` etc.) and
    // `material.color` MULTIPLIES it, so tinting them just washes the whole
    // character in the accent. Only untextured materials are safe — in practice
    // exactly Skeleton_Warrior's `Glow` (the eyes; no baseColorTexture,
    // emissiveFactor 1,1,0.19). Identity comes from the body itself; the accent
    // still rings the head bubble.
    const std = asStandardMaterial(copy);
    if (std && !std.map) {
      std.color = new THREE.Color(accent);
      std.emissive = new THREE.Color(accent);
      std.emissiveIntensity = 1.4; // reads as a glow through the Bloom pass
    }
    owned.set(mat, copy);
    return copy;
  };

  clone.traverse((obj) => {
    const mesh = asMesh(obj);
    if (!mesh) return;

    // 1. Hide the equipment pile (keep at most the whitelisted item). Returning
    //    before `ownMaterial` on purpose: a mesh that never renders needs no
    //    private copy, and its material must stay out of the fade list.
    if (inHandSlot(mesh) && mesh.name !== def.equip) {
      mesh.visible = false;
      return;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // 2. Take private ownership of the material(s), tinting on the way through.
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(ownMaterial)
      : ownMaterial(mesh.material);
  });

  // 3. Measure (bind pose, visible meshes only).
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  clone.traverse((obj) => {
    const mesh = asMesh(obj);
    if (!mesh || !mesh.visible) return;
    // "body" basis: skinned meshes only. Conveniently exact on this cast —
    // bodies/heads/limbs are skinned, while hats, helmets and weapons are plain
    // meshes parented to a bone.
    if (basis === "body" && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const geom = mesh.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    if (!geom.boundingBox) return;
    tmp.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);
    box.union(tmp);
  });

  const materials = [...owned.values()];

  if (box.isEmpty()) {
    return { scale: 1, y: groundY, headY: groundY, topY: groundY, materials };
  }

  const height = box.max.y - box.min.y;
  const scale = height > 1e-4 ? targetHeight / height : 1;
  const y = groundY - box.min.y * scale;
  // A point at clone-local `ly` renders at `y + ly * scale` (the clone is placed
  // at [0, y, 0] with a uniform `scale`), so both of these are in the character
  // group's space, ready for the camera rig.
  const topY = y + box.max.y * scale;

  // 4. Measure the head joint (bind pose — the mixer hasn't touched the clone).
  //
  //    `bone.matrixWorld` is only clone-LOCAL while the clone is detached, which
  //    it is on the first render but not if this memo is ever re-run after mount
  //    (e.g. the accent colour changes). Cancelling the clone's own matrixWorld
  //    makes the result parent-independent either way, so the focus target can
  //    never silently pick up the ring offset twice.
  const bone = clone.getObjectByName(HEAD_JOINT);
  let headY = y + (box.min.y + (box.max.y - box.min.y) * 0.55) * scale;
  if (bone) {
    const rel = new THREE.Matrix4()
      .copy(clone.matrixWorld)
      .invert()
      .multiply(bone.matrixWorld);
    headY = y + new THREE.Vector3().setFromMatrixPosition(rel).y * scale;
  }

  return { scale, y, headY, topY, materials };
}
