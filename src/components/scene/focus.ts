import type * as THREE from "three";

/**
 * Registry that lets the CAMERA RIG find a character's face without knowing
 * anything about models, scales or the ring layout.
 *
 * Why a registry and not geometry in the rig: the focus target must be the
 * MEASURED head, and head height is per-model (the four GLBs are authored at
 * different scales, so the same `head` joint lands anywhere from y≈1.14 to
 * y≈1.29 once each body is normalised to TARGET_HEIGHT). Only `Character` — the
 * thing that loaded and measured that specific GLB — can know it. So each
 * character publishes a static "face anchor" Object3D and the rig just reads its
 * world matrix.
 *
 * The anchor is an EMPTY group parented to the character's ring group, NOT the
 * animated `head` bone. Aiming at the live bone would let a head-bob drag the
 * camera around during the focus gesture. The anchor gives us a measured height
 * with a rock-steady target, and its world quaternion carries the ring yaw — so
 * the rig can read the character's facing direction off it for free.
 */
export interface FocusAnchors {
  /** Publish `obj` as `id`'s face anchor. Returns the unregister fn. */
  register(id: string, obj: THREE.Object3D): () => void;
  get(id: string): THREE.Object3D | undefined;
}

/**
 * `onChange` fires on every (un)register so the owner can bump an epoch and let
 * the rig re-run. Without it, setting `focusedId` for a character that hasn't
 * mounted yet (Suspense still fetching its GLB) would find no anchor and the
 * focus would be silently dropped forever — there'd be nothing to retry on.
 */
export function createFocusAnchors(onChange: () => void): FocusAnchors {
  const map = new Map<string, THREE.Object3D>();
  return {
    register(id, obj) {
      map.set(id, obj);
      onChange();
      return () => {
        if (map.get(id) === obj) {
          map.delete(id);
          onChange();
        }
      };
    },
    get(id) {
      return map.get(id);
    },
  };
}
