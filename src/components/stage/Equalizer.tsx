"use client";

import styles from "./Equalizer.module.css";

/**
 * A little animated equalizer that appears above a character while it is
 * "singing" (streaming). Bars use the agent accent color and bounce on a
 * looping keyframe with staggered delays for a lively beat.
 */
export function Equalizer({ accentIndex, active }: { accentIndex: number; active: boolean }) {
  const accent = `var(--agent-${accentIndex})`;
  const bars = [0, 1, 2, 3, 4];
  return (
    <div className={styles.eq} aria-hidden data-active={active}>
      {bars.map((i) => (
        <span
          key={i}
          className={`stage-motion ${styles.bar}`}
          style={{
            background: accent,
            animationDelay: `${i * 90}ms`,
            animationPlayState: active ? "running" : "paused",
            opacity: active ? 1 : 0.25,
          }}
        />
      ))}
    </div>
  );
}
