"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AgentConfig } from "@/lib/types";
import { loadAgents } from "@/lib/storage";
import { useStreamingGrade } from "@/hooks/useStreamingGrade";
import { defaultAgents } from "@/lib/providers";
import { ProblemInputs } from "@/components/inputs/ProblemInputs";
import { Stage, type Performer } from "@/components/stage/Stage";
import { AgentCard } from "@/components/results/AgentCard";
import { SummaryPanel } from "@/components/results/SummaryPanel";
import { AgentStatusBar } from "@/components/status/AgentStatusBar";
import type { CharacterStatus } from "@/components/stage/SpriteCharacter";
import styles from "./page.module.css";

type ViewMode = "basic" | "fancy";

const MODE_KEY = "agb.mode.v1";

export default function Home() {
  const [agents, setAgents] = useState<AgentConfig[]>(() => defaultAgents());
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [answer, setAnswer] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [mode, setMode] = useState<ViewMode>("basic");

  const { state, run, revise, reset } = useStreamingGrade();

  // Hydrate agents from localStorage after mount (edited on /settings).
  useEffect(() => {
    setAgents(loadAgents());
  }, []);

  // Hydrate view mode from localStorage after mount (SSR-safe).
  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === "basic" || saved === "fancy") setMode(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  const busy =
    state.phase === "extracting" ||
    state.phase === "judging" ||
    state.phase === "summarizing";

  const enabledAgents = useMemo(
    () => agents.filter((a) => a.enabled && a.apiKey && a.model && a.baseUrl),
    [agents],
  );

  const inputsReady = question.trim() && notes.trim() && answer.trim();
  const started = state.phase !== "idle";

  const onInputChange = (field: "question" | "notes" | "answer", value: string) => {
    if (field === "question") setQuestion(value);
    else if (field === "notes") setNotes(value);
    else setAnswer(value);
  };

  const handlePrimary = () => {
    if (state.phase === "done" && state.round >= 1) {
      void revise(answer);
    } else {
      void run(question, notes, answer, agents);
    }
  };

  // Build the stage lineup. Before a run, show the enabled agents idling.
  const performers: Performer[] = useMemo(() => {
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

  return (
    <div className={focusMode ? "focus-mode" : ""}>
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
              onClick={() => setMode((m) => (m === "basic" ? "fancy" : "basic"))}
              aria-pressed={mode === "fancy"}
              title="切换极简版 / 炫技版"
            >
              {mode === "basic" ? <BoltIcon /> : <SparkIcon />}
              {mode === "basic" ? "极简版" : "炫技版"}
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

        {mode === "fancy" ? (
          <Stage performers={performers} extracting={state.phase === "extracting"} />
        ) : (
          <AgentStatusBar
            performers={performers}
            extracting={state.phase === "extracting"}
          />
        )}

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
            {started && !busy && (
              <button type="button" className={styles.ghostBtn} onClick={reset}>
                重置
              </button>
            )}
            {mode === "fancy" && (
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => setFocusMode((v) => !v)}
                aria-pressed={focusMode}
              >
                {focusMode ? "演出模式" : "专注模式"}
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

        {started && (
          <section className={styles.results}>
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
        )}
      </main>
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

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
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
