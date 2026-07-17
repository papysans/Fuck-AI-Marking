"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { RunStatus } from "@/hooks/useStreamingGrade";
import type { Aggregate } from "@/lib/grading";
import { KeyPointList } from "./KeyPointList";
import styles from "./SummaryPanel.module.css";

function scoreColor(score: number): string {
  if (score >= 85) return "var(--color-success)";
  if (score >= 60) return "var(--color-primary)";
  return "var(--color-secondary)";
}

export function SummaryPanel({
  text,
  status,
  aggregate,
}: {
  text: string;
  status: RunStatus | "idle";
  aggregate?: Aggregate;
}) {
  const median = aggregate?.medianScore ?? 0;
  const scoreStyle: CSSProperties = { color: scoreColor(median) };
  const hasText = text.trim().length > 0;

  const textRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (status !== "streaming") return;
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, status]);

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="9" cy="6" r="2.4" fill="var(--color-surface-2)" />
          <circle cx="15" cy="12" r="2.4" fill="var(--color-surface-2)" />
          <circle cx="8" cy="18" r="2.4" fill="var(--color-surface-2)" />
        </svg>
        <h3 className={styles.heading}>制作人总结</h3>
      </header>

      <div className={styles.scoreRow}>
        <span className={styles.score} style={scoreStyle}>
          {median}
        </span>
        <span className={styles.scoreLabel}>评审团中位分</span>
      </div>

      {aggregate && aggregate.unionMissing.length > 0 && (
        <KeyPointList
          title="全员补漏清单（任一评审判缺失）"
          items={aggregate.unionMissing}
          tone="missing"
        />
      )}

      {aggregate && aggregate.disagreements.length > 0 && (
        <KeyPointList
          title="评审存在分歧（建议重点核实）"
          items={aggregate.disagreements}
          tone="partial"
        />
      )}

      {hasText ? (
        <p ref={textRef} className={styles.text}>
          {text}
        </p>
      ) : (
        <p className={styles.placeholder}>
          完成全部评审后，这里给出按优先级排序的修改清单
        </p>
      )}

      {status === "streaming" && (
        <div className={styles.pulseRow}>
          <span className={styles.pulse} aria-hidden="true" />
          <span className={styles.pulseLabel}>汇总中</span>
        </div>
      )}
    </section>
  );
}
