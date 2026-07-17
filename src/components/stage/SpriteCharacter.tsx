"use client";

import styles from "./SpriteCharacter.module.css";

/**
 * The HTML overlay for one performer: name, riser glow, and (optionally) a 2D
 * sprite sheet. The 3D robot itself is NOT rendered here — it is drawn by the
 * single vanilla-Three.js canvas in StageCanvas.tsx that sits behind this slot.
 * The `figure` div is kept as a transparent spacer so the row keeps its size and
 * the robot shows through from the background canvas. The `sprite` prop remains
 * a 2D sprite-sheet upgrade path with an identical API.
 */
export interface SpriteConfig {
  sheetUrl: string;
  frameCount: number;
  fps: number;
  /** frame height in px (sheet is a single horizontal strip) */
  frameHeight: number;
  frameWidth: number;
}

export type CharacterStatus = "pending" | "streaming" | "done" | "error";

type Pose = "idle" | "sing" | "win" | "lose" | "error";

interface Props {
  name: string;
  accentIndex: number;
  status: CharacterStatus;
  score?: number;
  dim?: boolean;
  sprite?: SpriteConfig;
}

function poseOf(status: CharacterStatus, score?: number): Pose {
  if (status === "streaming") return "sing";
  if (status === "error") return "error";
  if (status === "done") return typeof score === "number" && score >= 60 ? "win" : "lose";
  return "idle";
}

const poseClass: Record<Pose, string> = {
  idle: styles.idle,
  sing: styles.singing,
  win: styles.win,
  lose: styles.lose,
  error: styles.errored,
};

export function SpriteCharacter({ name, accentIndex, status, score, dim, sprite }: Props) {
  const accent = `var(--agent-${accentIndex})`;
  const pose = poseOf(status, score);

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.figure} stage-motion ${poseClass[pose]} ${dim ? styles.dim : ""}`}
        style={{ ["--accent" as string]: accent }}
        aria-hidden
      >
        {sprite ? (
          <div
            className={styles.spriteSheet}
            style={{
              width: sprite.frameWidth,
              height: sprite.frameHeight,
              backgroundImage: `url(${sprite.sheetUrl})`,
              animation:
                status === "streaming"
                  ? `sprite-play ${sprite.frameCount / sprite.fps}s steps(${sprite.frameCount}) infinite`
                  : "none",
            }}
          />
        ) : null}
      </div>
      <div
        className={styles.riser}
        style={{ background: `radial-gradient(closest-side, ${accent}, transparent)` }}
      />
      <div className={styles.name} title={name}>
        {name}
      </div>
    </div>
  );
}
