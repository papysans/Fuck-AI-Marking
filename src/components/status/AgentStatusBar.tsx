"use client";

import styles from "./AgentStatusBar.module.css";

export interface StatusPerformer {
  id: string;
  name: string;
  accentIndex: number;
  status: "pending" | "streaming" | "done" | "error";
  score?: number;
}

export interface AgentStatusBarProps {
  performers: StatusPerformer[];
  extracting: boolean;
}

function scoreClass(score: number): string {
  if (score >= 85) return styles.scoreSuccess;
  if (score >= 60) return styles.scorePrimary;
  return styles.scoreSecondary;
}

/**
 * Lightweight, non-3D status readout for "basic" view mode. Mirrors the stage's
 * performer lineup as a row of chips — no WebGL, no heavy animation.
 */
export function AgentStatusBar({ performers, extracting }: AgentStatusBarProps) {
  if (performers.length === 0) return null;

  return (
    <div className={styles.bar}>
      {extracting && (
        <p className={styles.extracting} role="status">
          <span className={styles.pulse} aria-hidden="true" />
          正在从课堂笔记抽取要点清单…
        </p>
      )}
      <ul className={styles.chips}>
        {performers.map((p) => (
          <li key={p.id} className={styles.chip}>
            <span
              className={styles.dot}
              style={{ background: `var(--agent-${p.accentIndex})` }}
              aria-hidden="true"
            />
            <span className={styles.name}>{p.name}</span>
            {p.status === "pending" && (
              <span className={styles.state}>待命</span>
            )}
            {p.status === "streaming" && (
              <span className={styles.state}>
                <span className={styles.pulse} aria-hidden="true" />
                评分中…
              </span>
            )}
            {p.status === "done" && (
              <span className={`${styles.state} ${scoreClass(p.score ?? 0)}`}>
                {typeof p.score === "number" ? `${p.score} 分` : "完成"}
              </span>
            )}
            {p.status === "error" && (
              <span className={`${styles.state} ${styles.scoreSecondary}`}>
                评分失败
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
