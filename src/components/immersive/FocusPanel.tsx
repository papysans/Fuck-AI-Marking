"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { ScenePerformer } from "@/components/scene/ImmersiveScene";
import { accentVar, scoreColor } from "./accents";
import styles from "./FocusPanel.module.css";

/**
 * Solo mode: one reviewer's full commentary, large and readable.
 *
 * Shown only while the camera is framing this reviewer. The scene hides the
 * focused character's head bubble and fades the rest out, so this panel is the
 * single place their words appear — the bubble and the panel are never both
 * showing the same text.
 */
export function FocusPanel({
  performer,
  error,
  onBack,
}: {
  performer: ScenePerformer;
  error?: string;
  onBack: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Stick to the newest tokens while this reviewer is still speaking.
  useEffect(() => {
    if (performer.status !== "streaming") return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [performer.commentary, performer.status]);

  const style = { "--accent": accentVar(performer.accentIndex) } as CSSProperties;
  // Bind then narrow: keeps `score` a real number below, no assertion.
  const score = performer.score;
  const text = performer.commentary.trim();

  return (
    <section className={styles.panel} style={style} aria-label={`${performer.name} 的点评`}>
      <header className={styles.head}>
        <span className={styles.dot} aria-hidden="true" />
        <h2 className={styles.name}>{performer.name}</h2>
        {typeof score === "number" && (
          <span className={styles.score} style={{ color: scoreColor(score) }}>
            {score}
          </span>
        )}
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <BackIcon />
          返回全景
        </button>
      </header>

      <div
        className={styles.body}
        ref={bodyRef}
        tabIndex={0}
        role="region"
        aria-label={`${performer.name} 的完整点评`}
      >
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : text ? (
          <p className={styles.text}>{text}</p>
        ) : (
          <p className={styles.placeholder}>
            {performer.status === "pending" ? "这位评审还没开口。" : "等待发言…"}
          </p>
        )}
      </div>

      {performer.status === "streaming" && (
        <div className={styles.pulseRow}>
          <span className={styles.pulse} aria-hidden="true" />
          <span className={styles.pulseLabel}>评分中</span>
        </div>
      )}
    </section>
  );
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19 12H5m0 0l6-6m-6 6l6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
