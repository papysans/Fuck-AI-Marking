"use client";

import type { CSSProperties } from "react";
import type { RunStatus } from "@/hooks/useStreamingGrade";
import type { Aggregate } from "@/lib/grading";
import { SummaryPanel } from "@/components/results/SummaryPanel";
import { scoreColor } from "./accents";
import styles from "./SummaryStage.module.css";

/**
 * The producer's summary, centre stage.
 *
 * This is the product's actual output (the priority-ordered fix list), so it
 * gets its own act instead of hiding behind the result modal. The content is
 * NOT reimplemented here: `results/SummaryPanel` already renders the big median
 * score, the union-of-missing list, the disagreement list and the streaming
 * text with bottom-stick. This component only supplies the centred glass
 * container and a collapse control so the stage stays reachable.
 */
export function SummaryStage({
  text,
  status,
  aggregate,
  collapsed,
  onToggle,
}: {
  text: string;
  status: RunStatus | "idle";
  aggregate?: Aggregate;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const median = aggregate?.medianScore;
  const medianStyle: CSSProperties =
    typeof median === "number" ? { color: scoreColor(median) } : {};

  // Collapsed: a single bar. SummaryPanel is unmounted, so its heading never
  // competes with this one — the two states never show the same words twice.
  if (collapsed) {
    return (
      <section className={`${styles.stage} ${styles.stageCollapsed}`}>
        <button
          type="button"
          className={styles.collapsedBar}
          onClick={onToggle}
          aria-expanded={false}
          title="展开合议裁定"
        >
          {status === "streaming" && <span className={styles.livePulse} aria-hidden="true" />}
          <span className={styles.collapsedTitle}>合议裁定</span>
          {typeof median === "number" && (
            <span className={styles.collapsedScore} style={medianStyle}>
              {median}
            </span>
          )}
          <span className={styles.collapsedHint}>
            展开
            <ChevronIcon up />
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className={styles.stage} aria-label="合议裁定">
      <div className={styles.head}>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggle}
          aria-expanded
          title="收起裁定，回看圆桌"
        >
          收起
          <ChevronIcon />
        </button>
      </div>

      {/* Body owns the scroll so a long fix list never grows past the viewport. */}
      <div className={styles.body}>
        <SummaryPanel text={text} status={status} aggregate={aggregate} />
      </div>
    </section>
  );
}

function ChevronIcon({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={up ? { transform: "rotate(180deg)" } : undefined}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
