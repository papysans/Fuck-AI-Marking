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

export interface AnimationPlan {
  pending: string | null;
  /** Non-empty whenever anything is playable; cycled while streaming. */
  stream: string[];
  win: string | null;
  lose: string | null;
  error: string | null;
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
}

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

  clone.traverse((obj) => {
    const mesh = asMesh(obj);
    if (!mesh) return;

    // 1. Hide the equipment pile (keep at most the whitelisted item).
    if (inHandSlot(mesh) && mesh.name !== def.equip) {
      mesh.visible = false;
      return;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // 2. Tint. KayKit bodies use ONE atlas texture (`knight_texture` etc.) and
    //    `material.color` MULTIPLIES it, so tinting them just washes the whole
    //    character in the accent. Only untextured materials are safe — in
    //    practice exactly Skeleton_Warrior's `Glow` (the eyes; no
    //    baseColorTexture, emissiveFactor 1,1,0.19). Identity comes from the
    //    body itself; the accent still rings the head bubble.
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tintedMats = mats.map((mat) => {
      const std = asStandardMaterial(mat);
      if (!std || std.map) return mat;
      // SkeletonUtils.clone SHARES materials, so tint a per-instance copy or
      // every skeleton on stage would take the last reviewer's colour.
      const tinted = std.clone();
      tinted.color = new THREE.Color(accent);
      tinted.emissive = new THREE.Color(accent);
      tinted.emissiveIntensity = 1.4; // reads as a glow through the Bloom pass
      return tinted;
    });
    mesh.material = Array.isArray(mesh.material) ? tintedMats : tintedMats[0];
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

  if (box.isEmpty()) return { scale: 1, y: groundY };

  const height = box.max.y - box.min.y;
  const scale = height > 1e-4 ? targetHeight / height : 1;
  return { scale, y: groundY - box.min.y * scale };
}
