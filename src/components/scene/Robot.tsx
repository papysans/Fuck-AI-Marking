import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations, Html } from "@react-three/drei";
import type { ScenePerformer } from "./ImmersiveScene";
import { accentHex } from "./ImmersiveScene";

/**
 * One evaluator robot. RobotExpressive is a SkinnedMesh, so each robot MUST
 * clone via SkeletonUtils (sharing the raw scene corrupts the skeleton). Every
 * clone gets its own `useAnimations` mixer, its "Main" material tinted to the
 * reviewer's voice color, an animation state machine driven by the performer's
 * status/score, and a drei `<Html>` chat bubble above its head that streams the
 * reviewer's `commentary`.
 *
 * Deterministic per-index variation (never random) so re-renders are stable.
 */

// pending → idle-ish waiting poses (chosen by index)
const PENDING_POSES = ["Idle", "Standing", "Wave"] as const;
// streaming → "arguing": loop through animated gestures, cycling over time
const STREAM_CYCLE = ["Dance", "Wave", "Yes", "No", "Punch"] as const;

export function Robot({
  performer,
  index,
  count,
  reducedMotion,
}: {
  performer: ScenePerformer;
  index: number;
  count: number;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF("/models/RobotExpressive.glb");
  const color = accentHex(performer.accentIndex);

  // Independent skeleton per robot.
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  // Tint the body ("Main") material + enable shadows.
  useMemo(() => {
    clone.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mat = obj.material;
      if (mat instanceof THREE.MeshStandardMaterial && mat.name === "Main") {
        const tinted = mat.clone();
        tinted.color = new THREE.Color(color);
        obj.material = tinted;
      }
    });
  }, [clone, color]);

  const { actions } = useAnimations(animations, group);
  const active = useRef<THREE.AnimationAction | null>(null);

  // Crossfade helper (0.3s). Under reduced-motion: snap to a static pose frame.
  const play = useCallback(
    (
      name: string,
      opts?: { once?: boolean; timeScale?: number; phase?: number },
    ) => {
      const next = actions[name];
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
    [actions, reducedMotion],
  );

  // React to status/score changes → drive the state machine.
  const statusRef = useRef(performer.status);
  const streamTimer = useRef(0);
  const streamStep = useRef(0);

  useEffect(() => {
    statusRef.current = performer.status;
    switch (performer.status) {
      case "pending":
        play(PENDING_POSES[index % PENDING_POSES.length], {
          phase: index * 0.5, // stagger idle phase
        });
        break;
      case "streaming":
        streamTimer.current = 0;
        streamStep.current = 0;
        play(STREAM_CYCLE[index % STREAM_CYCLE.length], {
          timeScale: 0.9 + (index % 3) * 0.1,
        });
        break;
      case "done":
        play(
          performer.score != null && performer.score >= 60
            ? "ThumbsUp"
            : "Death",
          { once: true },
        );
        break;
      case "error":
        play("No", { once: true });
        break;
    }
  }, [performer.status, performer.score, index, play]);

  // Streaming = "arguing": swap gestures every 2-4s, staggered per robot.
  useFrame((_, dt) => {
    if (statusRef.current !== "streaming" || reducedMotion) return;
    streamTimer.current += dt;
    const interval = 2 + (index % 3); // 2s, 3s, 4s
    if (streamTimer.current >= interval) {
      streamTimer.current = 0;
      streamStep.current += 1;
      const name = STREAM_CYCLE[(streamStep.current + index) % STREAM_CYCLE.length];
      play(name, { timeScale: 0.9 + (index % 3) * 0.1 });
    }
  });

  return (
    <group ref={group}>
      {/* feet dropped onto the ContactShadows plane at y=-1; scaled around the
          clone origin (feet), so a slightly smaller robot stays grounded and
          gains a little more whitespace between neighbours. */}
      <primitive object={clone} position={[0, -1, 0]} scale={0.9} />
      <RobotBubble performer={performer} color={color} count={count} />
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
 * - A per-frame "front-ness" test (is this robot on the camera-facing side of
 *   the slowly spinning ring?) fades + shrinks bubbles that have rotated to the
 *   BACK into a small dim badge, so only the front-facing reviewers stay fully
 *   readable and the on-screen text never smears together.
 */
function RobotBubble({
  performer,
  color,
  count,
}: {
  performer: ScenePerformer;
  color: string;
  count: number;
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
    // Flatten to XZ: robot direction from ring center vs. camera direction.
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
  const distanceFactor = 6 + (6 - Math.min(count, 6)) * 0.6; // fewer → larger

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
          {/* tail pointing down at the robot */}
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

useGLTF.preload("/models/RobotExpressive.glb");
