"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { AgentRunView } from "@/hooks/useStreamingGrade";
import { KeyPointList } from "./KeyPointList";
import styles from "./AgentCard.module.css";

function scoreColor(score: number): string {
  if (score >= 85) return "var(--color-success)";
  if (score >= 60) return "var(--color-primary)";
  return "var(--color-secondary)";
}

export function AgentCard({
  run,
  name,
  accentIndex,
}: {
  run: AgentRunView;
  name: string;
  accentIndex: number;
}) {
  const { status, grade } = run;
  const revealed = status === "done" && Boolean(grade);

  const streamRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (status !== "streaming") return;
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.commentary, status]);
  const accentStyle = { "--accent": `var(--agent-${accentIndex})` } as CSSProperties;

  const badgeStyle: CSSProperties = grade
    ? {
        color: scoreColor(grade.score),
        borderColor: scoreColor(grade.score),
        ...(revealed ? { animation: "score-flip .6s ease both" } : {}),
      }
    : {};

  return (
    <section className={styles.card} style={accentStyle}>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.name}>{name}</span>
        </div>
        <span className={styles.badge} style={badgeStyle}>
          {grade ? grade.score : "…"}
        </span>
      </header>

      <div className={styles.body}>
        {status === "pending" && <p className={styles.muted}>排队中</p>}

        {status === "streaming" && (
          <>
            <p ref={streamRef} className={styles.stream}>
              {run.commentary}
            </p>
            <div className={styles.pulseRow}>
              <span className={styles.pulse} aria-hidden="true" />
              <span className={styles.pulseLabel}>评分中</span>
            </div>
          </>
        )}

        {status === "error" && <p className={styles.error}>{run.error}</p>}

        {status === "done" && grade && (
          <>
            {grade.invalid && (
              <p className={styles.error}>该评审输出解析失败，未计入评分</p>
            )}
            <p className={styles.stream}>{grade.commentary}</p>
            {!grade.invalid && (
              <>
                <div className={styles.breakdown}>
                  <span className={styles.chip}>命中 {grade.breakdown.covered}</span>
                  <span className={styles.chip}>不完整 {grade.breakdown.partial}</span>
                  <span className={styles.chip}>缺失 {grade.breakdown.missing}</span>
                  <span className={styles.chipMuted}>共 {grade.breakdown.total}</span>
                </div>
                <div className={styles.keyPointScroll}>
                  <KeyPointList title="缺失要点" items={grade.missing} tone="missing" />
                </div>
                <div className={styles.keyPointScroll}>
                  <KeyPointList title="不完整要点" items={grade.partial} tone="partial" />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
