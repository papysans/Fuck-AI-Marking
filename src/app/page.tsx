"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import type { AgentConfig } from "@/lib/types";
import { loadAgents } from "@/lib/storage";
import { useStreamingGrade } from "@/hooks/useStreamingGrade";
import { defaultAgents } from "@/lib/providers";
import { ProblemInputs } from "@/components/inputs/ProblemInputs";
import { AgentCard } from "@/components/results/AgentCard";
import { SummaryPanel } from "@/components/results/SummaryPanel";
import { KeyPointList } from "@/components/results/KeyPointList";
import { AgentStatusBar, type StatusPerformer } from "@/components/status/AgentStatusBar";
import { HistoryDrawer } from "@/components/history/HistoryDrawer";
import { ImmersiveShell } from "@/components/immersive/ImmersiveShell";
import type { CharacterStatus } from "@/components/stage/SpriteCharacter";
import { buildMarkdownReport, reportFileName, type ReportInput } from "@/lib/report";
import {
  appendHistory,
  clearHistory,
  loadHistory,
  removeHistory,
  type HistoryEntry,
} from "@/lib/history";
import styles from "./page.module.css";

type ViewMode = "basic" | "immersive";

const MODE_KEY = "agb.mode.v1";

export default function Home() {
  const [agents, setAgents] = useState<AgentConfig[]>(() => defaultAgents());
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<ViewMode>("basic");

  // History + report state.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // When set, the results area shows a read-only playback of a past snapshot
  // instead of the live grading run. `null` = live mode.
  const [viewing, setViewing] = useState<HistoryEntry | null>(null);
  const [copied, setCopied] = useState(false);
  // Guards the auto-save effect against duplicate writes for one round.
  const savedKeyRef = useRef<string | null>(null);

  const { state, run, revise, reset } = useStreamingGrade();

  // Hydrate agents from localStorage after mount (edited on /settings).
  useEffect(() => {
    setAgents(loadAgents());
  }, []);

  // Hydrate view mode from localStorage after mount (SSR-safe).
  // Migration: the old "fancy" value maps to the new "immersive" mode.
  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === "immersive" || saved === "fancy") setMode("immersive");
    else if (saved === "basic") setMode("basic");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  // Load history once on mount (SSR-safe read inside loadHistory).
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const enabledAgents = useMemo(
    () => agents.filter((a) => a.enabled && a.apiKey && a.model && a.baseUrl),
    [agents],
  );

  // Auto-save a snapshot when a round completes. A fresh run passes through
  // "extracting" (resets the guard) so round 1 of a new problem always saves;
  // each revise() bumps `round`, giving a distinct guard key. appendHistory's
  // dedup keeps one row per problem across rounds (latest round wins).
  useEffect(() => {
    if (state.phase === "extracting") {
      savedKeyRef.current = null;
      return;
    }
    if (state.phase !== "done") return;
    const key = `${state.round}`;
    if (savedKeyRef.current === key) return;
    savedKeyRef.current = key;

    const snapshotAgents = enabledAgents.map((a) => {
      const g = state.runs[a.id]?.grade;
      return {
        name: a.name,
        accentIndex: a.accentIndex,
        score: g?.score ?? 0,
        invalid: g?.invalid ?? false,
        missing: g?.missing ?? [],
        partial: g?.partial ?? [],
        commentary: g?.commentary ?? state.runs[a.id]?.commentary ?? "",
      };
    });
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      question,
      notes,
      answer,
      mode,
      round: state.round,
      agents: snapshotAgents,
      median: state.aggregate?.medianScore ?? 0,
      unionMissing: state.aggregate?.unionMissing ?? [],
      disagreements: state.aggregate?.disagreements ?? [],
      summaryText: state.summaryText,
    };
    setHistory(appendHistory(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.round]);

  const busy =
    state.phase === "extracting" ||
    state.phase === "judging" ||
    state.phase === "summarizing";

  const inputsReady = question.trim() && notes.trim() && answer.trim();
  const started = state.phase !== "idle";

  const onInputChange = (field: "question" | "notes" | "answer", value: string) => {
    if (field === "question") setQuestion(value);
    else if (field === "notes") setNotes(value);
    else setAnswer(value);
  };

  const handlePrimary = () => {
    setViewing(null); // leave history playback when a live run starts
    if (state.phase === "done" && state.round >= 1) {
      void revise(answer);
    } else {
      void run(question, notes, answer, agents);
    }
  };

  const handleReset = () => {
    reset();
    setViewing(null);
    savedKeyRef.current = null;
  };

  // Copy the report to the clipboard AND download it as a .md file.
  const exportReport = async (input: ReportInput) => {
    const md = buildMarkdownReport(input);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — download still proceeds */
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(input.question);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const liveReportInput = (): ReportInput => ({
    question,
    notes,
    answer,
    round: state.round,
    agents: enabledAgents.map((a) => {
      const g = state.runs[a.id]?.grade;
      return {
        name: a.name,
        score: g?.score ?? 0,
        invalid: g?.invalid,
        missing: g?.missing ?? [],
        partial: g?.partial ?? [],
        commentary: g?.commentary ?? "",
      };
    }),
    median: state.aggregate?.medianScore ?? 0,
    unionMissing: state.aggregate?.unionMissing ?? [],
    disagreements: state.aggregate?.disagreements ?? [],
    summaryText: state.summaryText,
  });

  const entryReportInput = (e: HistoryEntry): ReportInput => ({
    question: e.question,
    notes: e.notes,
    answer: e.answer,
    round: e.round,
    agents: e.agents.map((a) => ({
      name: a.name,
      score: a.score,
      invalid: a.invalid,
      missing: a.missing,
      partial: a.partial,
      commentary: a.commentary,
    })),
    median: e.median,
    unionMissing: e.unionMissing,
    disagreements: e.disagreements,
    summaryText: e.summaryText,
  });

  // History drawer actions.
  const openHistory = () => {
    setHistory(loadHistory());
    setHistoryOpen(true);
  };
  const loadEntry = (e: HistoryEntry) => {
    setQuestion(e.question);
    setNotes(e.notes);
    setAnswer(e.answer);
    setViewing(e); // enter read-only playback
    setHistoryOpen(false);
  };
  const deleteEntry = (id: string) => {
    setHistory(removeHistory(id));
    if (viewing?.id === id) setViewing(null);
  };
  const clearAll = () => {
    setHistory(clearHistory());
    setViewing(null);
  };
  const newBlank = () => {
    reset();
    setQuestion("");
    setNotes("");
    setAnswer("");
    setViewing(null);
    setHistoryOpen(false);
    savedKeyRef.current = null;
  };

  // Build the stage lineup. Before a run, show the enabled agents idling.
  const performers: StatusPerformer[] = useMemo(() => {
    return enabledAgents.map((a) => {
      const runView = state.runs[a.id];
      const status: CharacterStatus = runView?.status ?? "pending";
      return {
        id: a.id,
        name: a.name,
        accentIndex: a.accentIndex,
        status: started ? status : "pending",
        score: runView?.grade?.score,
      };
    });
  }, [enabledAgents, state.runs, started]);

  const toggleMode = () => setMode((m) => (m === "basic" ? "immersive" : "basic"));

  const primaryLabel =
    state.phase === "extracting"
      ? "抽取要点中…"
      : state.phase === "judging"
        ? "评审演出中…"
        : state.phase === "summarizing"
          ? "制作人总结中…"
          : state.phase === "done" && state.round >= 1
            ? "带上下文重新评分"
            : "开始评分";

  if (mode === "immersive") {
    return (
      <div>
        <ImmersiveShell
          state={state}
          enabledAgents={enabledAgents}
          question={question}
          notes={notes}
          answer={answer}
          onInputChange={onInputChange}
          busy={busy}
          inputsReady={Boolean(inputsReady)}
          started={started}
          primaryLabel={primaryLabel}
          onPrimary={handlePrimary}
          onReset={handleReset}
          onToggleMode={toggleMode}
          onOpenHistory={openHistory}
          onExport={() => void exportReport(liveReportInput())}
          copied={copied}
        />
        <HistoryDrawer
          open={historyOpen}
          entries={history}
          activeId={viewing?.id}
          onClose={() => setHistoryOpen(false)}
          onLoad={loadEntry}
          onDelete={deleteEntry}
          onClear={clearAll}
          onNew={newBlank}
        />
      </div>
    );
  }

  return (
    <div>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>评分录音棚</h1>
            {state.round > 0 && (
              <span className={styles.roundBadge}>第 {state.round} 轮</span>
            )}
            <button
              type="button"
              className={styles.modeToggle}
              onClick={toggleMode}
              aria-pressed={false}
              title="切换 简洁 / 沉浸"
            >
              <SparkIcon />
              沉浸
            </button>
            <button
              type="button"
              className={styles.historyBtn}
              onClick={openHistory}
              title="查看历史记录"
            >
              <HistoryIcon />
              历史
            </button>
          </div>

          <div className={styles.teamBar}>
            {enabledAgents.length > 0 ? (
              <>
                <ul className={styles.teamList}>
                  {enabledAgents.map((a) => (
                    <li key={a.id} className={styles.teamMember}>
                      <span
                        className={styles.dot}
                        style={{ background: `var(--agent-${a.accentIndex})` }}
                        aria-hidden="true"
                      />
                      {a.name}
                    </li>
                  ))}
                </ul>
                <span className={styles.teamCount}>
                  {enabledAgents.length} 位评审待命
                </span>
                <Link href="/settings" className={styles.configLink}>
                  <GearIcon />
                  配置评审团
                </Link>
              </>
            ) : (
              <Link href="/settings" className={styles.configCta}>
                还没配置评审团
                <ArrowIcon />
              </Link>
            )}
          </div>
        </header>

        <AgentStatusBar
          performers={performers}
          extracting={state.phase === "extracting"}
        />

        <section className={styles.workbench}>
          <div className={styles.inputCard}>
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
              onClick={handlePrimary}
              disabled={busy || !inputsReady || enabledAgents.length === 0}
            >
              {primaryLabel}
            </button>
            {(started || viewing) && !busy && (
              <button type="button" className={styles.ghostBtn} onClick={handleReset}>
                重置
              </button>
            )}
            {enabledAgents.length === 0 && (
              <span className={styles.hint}>先到配置页填好评审团再开始</span>
            )}
          </div>

          {state.phase === "error" && state.error && (
            <div className={styles.errorBanner}>{state.error}</div>
          )}
        </section>

        {viewing ? (
          <section className={styles.results}>
            <div className={styles.reviewBanner}>
              <span className={styles.reviewTag}>
                <EyeIcon />
                历史回看 · 第 {viewing.round} 轮
              </span>
              <button
                type="button"
                className={styles.exportBtn}
                onClick={() => void exportReport(entryReportInput(viewing))}
              >
                {copied ? <CheckIcon /> : <DownloadIcon />}
                {copied ? "已复制" : "导出报告"}
              </button>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => setViewing(null)}
              >
                退出回看
              </button>
            </div>
            <div className={styles.cardsGrid}>
              {viewing.agents.map((a, i) => (
                <section
                  key={`${a.name}-${i}`}
                  className={styles.reviewCard}
                  style={{ "--accent": `var(--agent-${a.accentIndex})` } as CSSProperties}
                >
                  <header className={styles.reviewHead}>
                    <span className={styles.reviewName}>
                      <span className={styles.reviewDot} aria-hidden="true" />
                      {a.name}
                    </span>
                    <span className={styles.reviewBadge}>
                      {a.invalid ? "—" : a.score}
                    </span>
                  </header>
                  {a.invalid && (
                    <p className={styles.reviewInvalid}>该评审输出解析失败，未计入评分</p>
                  )}
                  {a.commentary.trim() && (
                    <p className={styles.reviewComment}>{a.commentary}</p>
                  )}
                  {!a.invalid && (
                    <>
                      <KeyPointList title="缺失要点" items={a.missing} tone="missing" />
                      <KeyPointList title="不完整要点" items={a.partial} tone="partial" />
                    </>
                  )}
                </section>
              ))}
            </div>
            <SummaryPanel
              text={viewing.summaryText}
              status="done"
              aggregate={{
                medianScore: viewing.median,
                unionMissing: viewing.unionMissing,
                disagreements: viewing.disagreements,
              }}
            />
          </section>
        ) : (
          started && (
            <section className={styles.results}>
              {state.phase === "done" && (
                <div className={styles.exportRow}>
                  <button
                    type="button"
                    className={styles.exportBtn}
                    onClick={() => void exportReport(liveReportInput())}
                  >
                    {copied ? <CheckIcon /> : <DownloadIcon />}
                    {copied ? "已复制" : "导出报告"}
                  </button>
                </div>
              )}
              <div className={styles.cardsGrid}>
                {enabledAgents.map((a) => (
                  <AgentCard
                    key={a.id}
                    name={a.name}
                    accentIndex={a.accentIndex}
                    run={state.runs[a.id] ?? { status: "pending", commentary: "" }}
                  />
                ))}
              </div>
              <SummaryPanel
                text={state.summaryText}
                status={state.summaryStatus}
                aggregate={state.aggregate}
              />
            </section>
          )
        )}
      </main>

      <HistoryDrawer
        open={historyOpen}
        entries={history}
        activeId={viewing?.id}
        onClose={() => setHistoryOpen(false)}
        onLoad={loadEntry}
        onDelete={deleteEntry}
        onClear={clearAll}
        onNew={newBlank}
      />
    </div>
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

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l1.8 4.9L18.7 9.7 13.8 11.5 12 16.4 10.2 11.5 5.3 9.7 10.2 7.9 12 3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
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

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
