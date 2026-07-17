"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AgentConfig } from "@/lib/types";
import type { GradeState } from "@/hooks/useStreamingGrade";
import { ImmersiveScene, type ScenePerformer } from "@/components/scene/ImmersiveScene";
import { ProblemInputs } from "@/components/inputs/ProblemInputs";
import { ResultModal } from "./ResultModal";
import styles from "./ImmersiveShell.module.css";

type Field = "question" | "notes" | "answer";

export function ImmersiveShell({
  state,
  enabledAgents,
  question,
  notes,
  answer,
  onInputChange,
  busy,
  inputsReady,
  started,
  primaryLabel,
  onPrimary,
  onReset,
  onToggleMode,
  onOpenHistory,
  onExport,
  copied,
}: {
  state: GradeState;
  enabledAgents: AgentConfig[];
  question: string;
  notes: string;
  answer: string;
  onInputChange: (field: Field, value: string) => void;
  busy: boolean;
  inputsReady: boolean;
  started: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  onReset: () => void;
  onToggleMode: () => void;
  onOpenHistory: () => void;
  onExport: () => void;
  copied: boolean;
}) {
  const [inputsOpen, setInputsOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Map enabled reviewers → scene performers. `commentary` carries the live
  // streamed review so each robot's head bubble shows real streaming text.
  const performers: ScenePerformer[] = useMemo(
    () =>
      enabledAgents.map((a) => ({
        id: a.id,
        name: a.name,
        accentIndex: a.accentIndex,
        status: state.runs[a.id]?.status ?? "pending",
        score: state.runs[a.id]?.grade?.score,
        commentary: state.runs[a.id]?.commentary ?? "",
      })),
    [enabledAgents, state.runs],
  );

  const showResultButton = state.phase === "done" || started;

  return (
    <div className={styles.root}>
      <div className={styles.sceneLayer}>
        <ImmersiveScene performers={performers} extracting={state.phase === "extracting"} />
      </div>

      <div className={styles.overlay}>
        {/* ① Title card */}
        <div className={`${styles.card} ${styles.titleCard}`}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>评分录音棚</h1>
            {state.round > 0 && (
              <span className={styles.roundBadge}>第 {state.round} 轮</span>
            )}
          </div>
          <div className={styles.titleActions}>
            <button
              type="button"
              className={styles.pill}
              onClick={onToggleMode}
              title="切换 简洁 / 沉浸"
            >
              <LayoutIcon />
              简洁
            </button>
            <Link href="/settings" className={styles.pill}>
              <GearIcon />
              配置评审团
            </Link>
            <button type="button" className={styles.pill} onClick={onOpenHistory}>
              <HistoryIcon />
              历史
            </button>
          </div>
          <p className={styles.teamLine}>
            {enabledAgents.length > 0
              ? `${enabledAgents.length} 位评审待命`
              : "还没配置评审团"}
          </p>
        </div>

        {/* ② Input card (collapsible) */}
        <div className={`${styles.card} ${styles.inputCard}`}>
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={() => setInputsOpen((v) => !v)}
            aria-expanded={inputsOpen}
          >
            <span>{inputsOpen ? "收起输入" : "展开输入"}</span>
            <ChevronIcon open={inputsOpen} />
          </button>

          {inputsOpen && (
            <>
              <div className={styles.inputScroll}>
                <ProblemInputs
                  question={question}
                  notes={notes}
                  answer={answer}
                  onChange={onInputChange}
                  disabled={busy}
                />
              </div>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={onPrimary}
                  disabled={busy || !inputsReady || enabledAgents.length === 0}
                >
                  {primaryLabel}
                </button>
                {started && !busy && (
                  <button type="button" className={styles.ghostBtn} onClick={onReset}>
                    重置
                  </button>
                )}
              </div>
              {state.phase === "error" && state.error && (
                <p className={styles.error}>{state.error}</p>
              )}
              {enabledAgents.length === 0 && (
                <p className={styles.hint}>先到配置页填好评审团再开始</p>
              )}
            </>
          )}
        </div>

        {/* ③ View full result */}
        {showResultButton && (
          <div className={styles.resultCta}>
            <button
              type="button"
              className={styles.resultBtn}
              onClick={() => setModalOpen(true)}
            >
              查看完整结果
            </button>
          </div>
        )}
      </div>

      <ResultModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        agents={enabledAgents}
        runs={state.runs}
        summaryText={state.summaryText}
        summaryStatus={state.summaryStatus}
        aggregate={state.aggregate}
        round={state.round}
        onExport={onExport}
        copied={copied}
        canExport={state.phase === "done"}
      />
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}
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

function LayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18M9 9v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v3.5H6.5M12 7v5l3.5 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
