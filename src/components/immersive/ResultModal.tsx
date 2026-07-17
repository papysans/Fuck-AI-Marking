"use client";

import { useEffect, useRef } from "react";
import type { AgentConfig } from "@/lib/types";
import type { AgentRunView, RunStatus } from "@/hooks/useStreamingGrade";
import type { Aggregate } from "@/lib/grading";
import { AgentCard } from "@/components/results/AgentCard";
import { SummaryPanel } from "@/components/results/SummaryPanel";
import styles from "./ResultModal.module.css";

export function ResultModal({
  open,
  onClose,
  agents,
  runs,
  summaryText,
  summaryStatus,
  aggregate,
  round,
  onExport,
  copied,
  canExport,
}: {
  open: boolean;
  onClose: () => void;
  agents: AgentConfig[];
  runs: Record<string, AgentRunView>;
  summaryText: string;
  summaryStatus: RunStatus | "idle";
  aggregate?: Aggregate;
  round: number;
  onExport: () => void;
  copied: boolean;
  canExport: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc to close + focus the panel when it opens (lightweight focus handling).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="完整评分结果"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>
            完整评分结果
            {round > 0 && <span className={styles.round}>第 {round} 轮</span>}
          </h2>
          <div className={styles.headActions}>
            {canExport && (
              <button type="button" className={styles.exportBtn} onClick={onExport}>
                {copied ? <CheckIcon /> : <DownloadIcon />}
                {copied ? "已复制" : "导出报告"}
              </button>
            )}
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="关闭"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className={styles.scroll}>
          <div className={styles.cardsGrid}>
            {agents.map((a) => (
              <AgentCard
                key={a.id}
                name={a.name}
                accentIndex={a.accentIndex}
                run={runs[a.id] ?? { status: "pending", commentary: "" }}
              />
            ))}
          </div>
          <SummaryPanel text={summaryText} status={summaryStatus} aggregate={aggregate} />
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
