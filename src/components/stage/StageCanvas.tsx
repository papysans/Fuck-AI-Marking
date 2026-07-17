"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterStatus } from "./SpriteCharacter";

/**
 * The ONE shared WebGL context for the whole stage — rebuilt in *vanilla*
 * Three.js (no react-three-fiber / drei). A single WebGLRenderer + Scene +
 * PerspectiveCamera draws every reviewer robot; each performer gets an
 * independently-skinned clone of RobotExpressive.glb spaced along the x axis.
 *
 * Why vanilla: the r3f/drei `<View>` approach rendered nothing in real browsers
 * (blank stage). This owns the renderer imperatively so we can guarantee the
 * canvas is in the DOM with a non-zero size, the models are added to the scene,
 * and the camera is auto-framed to keep the whole lineup visible.
 *
 * The canvas sits as a low z-index background; the HTML overlay (names,
 * equalizers, score badges, POW stars) floats above it from Stage.tsx.
 */

const MODEL_URL = "/models/RobotExpressive.glb";

/** Accent palette mirrors --agent-1..6 in globals.css. accentIndex is 1-based. */
const AGENT_HEX = ["#ff5c7a", "#ffc24b", "#57e0a6", "#5ab4ff", "#b98bff", "#ff8ad1"];

const CLIP_LIST = ["Idle", "Dance", "ThumbsUp", "Death", "No"] as const;
type ClipName = (typeof CLIP_LIST)[number];

const LOOPING: Record<ClipName, boolean> = {
  Idle: true,
  Dance: true,
  ThumbsUp: false,
  Death: false,
  No: false,
};

/** status (+score) → animation clip. */
function clipFor(status: CharacterStatus, score?: number): ClipName {
  switch (status) {
    case "streaming":
      return "Dance";
    case "error":
      return "No";
    case "done":
      return typeof score === "number" && score >= 60 ? "ThumbsUp" : "Death";
    default:
      return "Idle";
  }
}

export interface RobotSpec {
  id: string;
  accentIndex: number;
  status: CharacterStatus;
  score?: number;
}

// Load the GLB exactly once across every mount. Cached module-side.
let gltfCache: GLTF | null = null;
let gltfPromise: Promise<GLTF> | null = null;
function loadRobot(): Promise<GLTF> {
  if (gltfCache) return Promise.resolve(gltfCache);
  if (!gltfPromise) {
    gltfPromise = new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().load(
        MODEL_URL,
        (g) => {
          gltfCache = g;
          resolve(g);
        },
        undefined,
        reject,
      );
    });
  }
  return gltfPromise;
}

interface RobotEntry {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<ClipName, THREE.AnimationAction>;
  current: ClipName | null;
  tintedMats: THREE.Material[];
}

export default function StageCanvas({ performers }: { performers: RobotSpec[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ sync: (specs: RobotSpec[]) => void } | null>(null);

  // ---- one-time setup: renderer / scene / camera / loop -------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 1, 8);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    // Bright, even lighting so the robots are unmistakably visible.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.1));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(3, 5, 4);
    scene.add(dir);

    const clock = new THREE.Clock();
    const robots = new Map<string, RobotEntry>();
    const SPACING = 2.0;
    let desired: RobotSpec[] = [];

    function sizeToHost() {
      const w = Math.max(host!.clientWidth, 1);
      const h = Math.max(host!.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    // Auto-frame the whole lineup so it is always fully visible & well-sized.
    function refit() {
      if (robots.size === 0) return;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      robots.forEach((e) => box.expandByObject(e.root));
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const fov = (camera.fov * Math.PI) / 180;
      const aspect = Math.max(camera.aspect, 0.0001);
      const distV = size.y / 2 / Math.tan(fov / 2);
      const distH = size.x / 2 / (Math.tan(fov / 2) * aspect);
      const dist = Math.max(distV, distH) * 1.25 + size.z + 1;
      camera.position.set(center.x, center.y + size.y * 0.04, center.z + dist);
      camera.lookAt(center.x, center.y, center.z);
      camera.updateProjectionMatrix();
    }

    function layout() {
      const entries = [...robots.values()];
      const n = entries.length;
      entries.forEach((e, i) => {
        e.root.position.set((i - (n - 1) / 2) * SPACING, 0, 0);
        e.root.rotation.y = 0; // RobotExpressive faces +Z → toward the camera
      });
      refit();
    }

    function play(entry: RobotEntry, clip: ClipName, immediate: boolean) {
      if (entry.current === clip) return;
      const next = entry.actions.get(clip);
      if (!next) return;
      const prev = entry.current ? entry.actions.get(entry.current) : null;

      next.reset();
      next.enabled = true;
      if (LOOPING[clip]) {
        next.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        next.setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true;
      }
      next.timeScale = reducedMotion ? 0 : 1;
      next.fadeIn(prev && !immediate ? 0.3 : 0).play();
      if (prev && prev !== next) prev.fadeOut(immediate ? 0 : 0.3);
      entry.current = clip;

      // When motion is disabled the loop won't advance the mixer, so apply the
      // target pose once here to leave the robot in a static, non-T-pose stance.
      if (reducedMotion) entry.mixer.update(0);
    }

    function buildRobot(gltf: GLTF, spec: RobotSpec): RobotEntry {
      const root = cloneSkeleton(gltf.scene);
      const hex = AGENT_HEX[((spec.accentIndex - 1) % 6 + 6) % 6];
      const tintedMats: THREE.Material[] = [];

      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material;
        if (Array.isArray(mat)) return;
        // Tint only the body material ("Main") with this reviewer's voice color.
        if (mat && mat.name === "Main") {
          const cloned = (mat as THREE.MeshStandardMaterial).clone();
          cloned.color.set(hex);
          mesh.material = cloned;
          tintedMats.push(cloned);
        }
      });

      const mixer = new THREE.AnimationMixer(root);
      const actions = new Map<ClipName, THREE.AnimationAction>();
      for (const clip of gltf.animations) {
        if ((CLIP_LIST as readonly string[]).includes(clip.name)) {
          actions.set(clip.name as ClipName, mixer.clipAction(clip));
        }
      }
      return { root, mixer, actions, current: null, tintedMats };
    }

    function disposeEntry(entry: RobotEntry) {
      entry.mixer.stopAllAction();
      entry.mixer.uncacheRoot(entry.root as THREE.Object3D);
      entry.root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
      entry.tintedMats.forEach((m) => m.dispose());
    }

    function sync(specs: RobotSpec[]) {
      desired = specs;
      if (!gltfCache) return; // will (re)build once the model finishes loading

      const wanted = new Set(specs.map((s) => s.id));
      for (const [id, entry] of robots) {
        if (!wanted.has(id)) {
          scene.remove(entry.root);
          disposeEntry(entry);
          robots.delete(id);
        }
      }

      for (const spec of specs) {
        let entry = robots.get(spec.id);
        const clip = clipFor(spec.status, spec.score);
        if (!entry) {
          entry = buildRobot(gltfCache, spec);
          robots.set(spec.id, entry);
          scene.add(entry.root);
          play(entry, clip, true);
        } else {
          play(entry, clip, false);
        }
      }

      layout();
    }

    apiRef.current = { sync };

    // Initial size + first paint (empty & transparent until the GLB arrives).
    sizeToHost();
    renderer.render(scene, camera);

    let raf = 0;
    function loop() {
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (!reducedMotion) robots.forEach((e) => e.mixer.update(dt));
      renderer.render(scene, camera);
    }
    loop();

    const ro = new ResizeObserver(() => {
      sizeToHost();
      refit();
    });
    ro.observe(host);

    // Seed with whatever performers exist now, then build once the model loads.
    sync(performers);
    let disposed = false;
    loadRobot()
      .then(() => {
        if (!disposed) sync(desired);
      })
      .catch((err) => {
        console.error("[StageCanvas] failed to load robot model", err);
      });

    return () => {
      disposed = true;
      apiRef.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      robots.forEach((e) => {
        scene.remove(e.root);
        disposeEntry(e);
      });
      robots.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- drive robot roster + animations from React state -------------------
  useEffect(() => {
    apiRef.current?.sync(performers);
  }, [performers]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        pointerEvents: "none",
      }}
    />
  );
}
