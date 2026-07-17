"use client";

import type { CSSProperties } from "react";
import type { ScenePerformer } from "@/components/scene/ImmersiveScene";
import { accentVar, scoreColor } from "./accents";
import styles from "./ReviewerChips.module.css";

/**
 * One compact chip per reviewer: accent dot + name + status/score.
 *
 * Deliberately carries NO review text — during `judging` the words live only in
 * each character's head bubble on stage, so this row is pure progress. The same
 * component doubles as the drill-down control once scores land: click a chip to
 * fly the camera to that reviewer and open their full commentary.
 */
export function ReviewerChips({
  performers,
  focusedId,
  onFocus,
  label = "评审",
}: {
  performers: ScenePerformer[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  label?: string;
}) {
  if (performers.length === 0) return null;

  return (
    <div className={styles.row} role="group" aria-label={label}>
      {performers.map((p) => {
        const focused = focusedId === p.id;
        // Bind then narrow: keeps `score` a real number below, no assertion.
        const score = p.score;
        const style = { "--accent": accentVar(p.accentIndex) } as CSSProperties;

        return (
          <button
            key={p.id}
            type="button"
            className={`${styles.chip} ${focused ? styles.chipActive : ""}`}
            style={style}
            aria-pressed={focused}
            onClick={() => onFocus(focused ? null : p.id)}
            title={focused ? "返回全景" : `聚焦 ${p.name}`}
          >
            <span
              className={`${styles.dot} ${p.status === "streaming" ? styles.dotLive : ""}`}
              aria-hidden="true"
            />
            <span className={styles.name}>{p.name}</span>
            {typeof score === "number" ? (
              <span className={styles.score} style={{ color: scoreColor(score) }}>
                <CheckIcon />
                {score}
              </span>
            ) : (
              <span className={styles.status}>{statusLabel(p.status)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function statusLabel(status: ScenePerformer["status"]): string {
  switch (status) {
    case "streaming":
      return "评分中…";
    case "error":
      return "失败";
    case "done":
      return "已完成";
    default:
      return "待命";
  }
}

function CheckIcon() {
  return (
    <svg
      className={styles.checkIcon}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
