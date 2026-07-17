"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AgentConfig } from "@/lib/types";
import type { GradeState } from "@/hooks/useStreamingGrade";
import { ImmersiveScene, type ScenePerformer } from "@/components/scene/ImmersiveScene";
import { ProblemInputs } from "@/components/inputs/ProblemInputs";
import { ReviewerChips } from "./ReviewerChips";
import { SummaryStage } from "./SummaryStage";
import { FocusPanel } from "./FocusPanel";
import { ResultModal } from "./ResultModal";
import styles from "./ImmersiveShell.module.css";

type Field = "question" | "notes" | "answer";

/**
 * THE SPATIAL CONTRACT. One act at a time, and — just as load-bearing — each act
 * has ONE home. The stage is a narrative, not a dashboard: review text is never
 * duplicated between the bubbles and a panel, and a panel is never parked on top
 * of the thing it is describing.
 *
 *   phase        3D stage        bubbles   UI panel
 *   ─────────────────────────────────────────────────────────────────────────
 *   idle         ring idles      hidden    input card (LEFT)
 *   extracting   ring idles      hidden    LEFT: folded input card + one-liner
 *   judging      argue           SHOWN     bottom chip rail only — NO panel
 *   summarizing  panorama        hidden    summary panel CENTRED, expanded
 *   done         panorama        hidden    same, chips under it
 *   focusedId    solo            hidden    focus panel LEFT-ANCHORED, chips under
 *
 * The three non-obvious entries, all of which this file got wrong before:
 *
 * - `focus` is LEFT, never centred. The scene trucks the focused face to ~65% of
 *   the viewport width precisely so a left-hand panel can exist (see
 *   FOCUS_SHIFT_NDC in CharacterCircle). A centred panel doesn't just waste that
 *   — it lands exactly on the face the camera just flew to.
 * - `judging` bubbles are the ONLY information source, so no panel may compete;
 *   `summarizing`/`done` are the exact inverse — the panel says everything the
 *   bubbles were saying, so the bubbles must leave (`showBubbles` below).
 * - The INPUT CARD is a prop of the idle act, not furniture. Every row below it
 *   in the table folds it to its bar, because it is the only thing on the left
 *   that can physically evict another act's protagonist (see `hostAct`).
 */
type StageView = "none" | "extracting" | "focus" | "summary";

/**
 * The acts that own the left column's height outright. Named, not a boolean,
 * because the input card's manual override is scoped to ONE of them — see
 * `inputsOpenedIn`.
 */
type HostAct = Extract<StageView, "focus" | "summary">;

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
  // Which reviewer the camera is framing. null → wide shot.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /**
   * The summary act: `summarizing` and `done` are ONE beat, not two. Derived and
   * not edge-detected, for the reason spelled out on `summaryCollapsed` below.
   */
  const summaryAct =
    started && (state.phase === "summarizing" || state.phase === "done");

  /**
   * Collapse override for the summary panel, SCOPED TO ONE OPEN ACT.
   *
   * ── Why the panel used to arrive at `done` collapsed ─────────────────────
   * The old code kept this as free-floating sticky state and re-opened it from
   * an effect that fired on `phase === "summarizing"`. Both halves are broken:
   *
   * 1. `done` had NO rule of its own. "Expanded at done" was never implemented —
   *    it was a leftover from having passed through `summarizing` with nobody
   *    touching the toggle in between. So one collapse during the multi-second
   *    streaming summary hid the payoff for good, and no later phase undid it.
   * 2. It edge-detected a TRANSIENT phase. Effects see RENDERED states, not
   *    `setState` calls. `runSummary` writes `phase:"summarizing"`, and the
   *    pipeline writes `phase:"done"` a few awaits later; React 18 batches across
   *    microtasks, so when no flush lands in between (a summary that fails or
   *    aborts fast) the component never renders with `phase === "summarizing"`
   *    at all and the effect simply never runs. Worse, `runSummary` early-returns
   *    BEFORE setting the phase when every grade is invalid — then `summarizing`
   *    is never even written, `judging` goes straight to `done`, and the panel
   *    shows up wearing whatever the previous round left behind.
   *
   * The fix is to stop chasing a transient with an effect and make "expanded"
   * STRUCTURAL: the override is erased the moment the act closes (below), so
   * every entry into the act — first run, revise round, reset-then-rerun, and
   * every path into `done` whether or not `summarizing` ever rendered — starts
   * from expanded because there is nothing left to override it. Collapse
   * survives exactly as long as the act it was made in, which is the contract:
   * collapsible, but only ever because the user said so.
   */
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  /**
   * Adjusting state during render — React's documented alternative to a reset
   * effect, and the right tool here: it re-renders before committing, so the act
   * can never PAINT one frame of a stale collapse the way an effect would. The
   * `summaryCollapsed &&` guard is what terminates it (the write flips the
   * condition false), exactly as the "adjusting state when props change" pattern
   * prescribes.
   */
  if (summaryCollapsed && !summaryAct) setSummaryCollapsed(false);

  /**
   * Grading starts → fold the input card down to a bar so the stage is clear.
   * Unchanged, but note what it now is and isn't: it governs the IDLE act's card
   * only (`showInputs` below routes around it once another act is up), and it is
   * safe as an effect precisely because `busy` is not a transient — it is held
   * across extracting→judging→summarizing, so it cannot be batched away the way
   * a single phase can.
   */
  useEffect(() => {
    if (busy) setInputsOpen(false);
  }, [busy]);

  // Never keep the camera on a reviewer who is no longer on stage.
  useEffect(() => {
    if (focusedId && !enabledAgents.some((a) => a.id === focusedId)) setFocusedId(null);
  }, [enabledAgents, focusedId]);

  /**
   * The producer's summary is the payoff, so it takes the wide shot back when the
   * act OPENS. Keyed on `summaryAct` (true across summarizing AND done) rather
   * than on `phase === "summarizing"`: the boolean is still true at `done`, so a
   * skipped/batched `summarizing` render cannot swallow the beat — see above.
   *
   * It fires only on the false→true edge, so drilling into a reviewer once the
   * act is up (the whole point of the chips under the panel) is left alone.
   */
  useEffect(() => {
    if (summaryAct) setFocusedId(null);
  }, [summaryAct]);

  // Map enabled reviewers → scene performers. `commentary` carries the live
  // streamed review so each robot's head bubble shows real streaming text; once
  // a run is done the parsed grade commentary is the canonical copy.
  const performers: ScenePerformer[] = useMemo(
    () =>
      enabledAgents.map((a) => {
        const run = state.runs[a.id];
        const commentary =
          (run?.status === "done" ? run.grade?.commentary : undefined) ?? run?.commentary ?? "";
        return {
          id: a.id,
          name: a.name,
          accentIndex: a.accentIndex,
          status: run?.status ?? "pending",
          score: run?.grade?.score,
          commentary,
        };
      }),
    [enabledAgents, state.runs],
  );

  const focused = focusedId ? (performers.find((p) => p.id === focusedId) ?? null) : null;

  const stageView: StageView = focused
    ? "focus"
    : state.phase === "extracting"
      ? "extracting"
      : summaryAct
        ? "summary"
        : "none";

  /**
   * THE INPUT CARD IS THE IDLE ACT'S PROP — the last piece of "one act at a
   * time" this file was still missing.
   *
   * Its fold was wired to `busy` and nothing else, and `busy` describes the RUN,
   * never the STAGE. The two stop agreeing at exactly the moment it matters:
   * `done` is not busy, and `done` is when the card is most likely to be open,
   * because the revise button lives INSIDE it — opening it there is the intended
   * way into round two, not a misuse. So the card kept the whole left column
   * while another act was playing:
   *
   * - summary act: an expanded card covers the ring the panorama flew out to show.
   * - focus act: it squeezes the focus panel — the protagonist of that act, in a
   *   deliberately capped column — down to a two-line slit. The panel is the only
   *   place that reviewer's words exist (the scene hides the focused bubble), so
   *   the act renders with its subject unreadable.
   *
   * Hence: whichever act holds the stage, the card folds to its bar. That costs
   * nothing — the bar is labelled 修改答案 once `started`, so it is still the
   * door to the revise round, just not a wall.
   *
   * `hostAct` is the act's IDENTITY rather than a boolean because the override
   * below is scoped to one act: drilling from the summary into a reviewer is a
   * NEW act, and its protagonist needs that height back just as much.
   */
  const hostAct: HostAct | null =
    stageView === "focus" || stageView === "summary" ? stageView : null;

  /**
   * The user can always pull the card back open over an act — that IS the revise
   * entry — and that has to stick: a toggle that snaps shut on the very next
   * render is a dead button, which is worse than the bug being fixed.
   *
   * Same shape as `summaryCollapsed` above, and for the same reason. This stores
   * WHICH act the card was opened in, and the store is erased during render the
   * instant that act closes. Nothing edge-detects "an act began": per the note
   * above, `summarizing` can go entirely unrendered and `runSummary` can skip it
   * altogether, so an effect watching for the start of an act is a coin flip.
   * Instead every entry into every act — first run, revise, drill-down, back to
   * panorama — begins folded because there is simply nothing left overriding it,
   * while a manual open survives exactly as long as the act it was made in. The
   * `!== hostAct` write flips its own condition false, so it terminates.
   */
  const [inputsOpenedIn, setInputsOpenedIn] = useState<HostAct | null>(null);
  if (inputsOpenedIn !== null && inputsOpenedIn !== hostAct) setInputsOpenedIn(null);

  // Idle act: the card is the act, so its own sticky state (and the `busy` fold)
  // decide. Under any other act: folded unless opened in THAT act.
  const showInputs = hostAct ? inputsOpenedIn === hostAct : inputsOpen;
  const toggleInputs = () => {
    if (hostAct) setInputsOpenedIn((v) => (v === hostAct ? null : hostAct));
    else setInputsOpen((v) => !v);
  };

  // The judging rail and the drill-down chips are the same row; only its home
  // changes. Never render both.
  const showRail = started && state.phase === "judging" && !focused;
  const showResultButton = started;

  return (
    <div className={styles.root}>
      <div className={styles.sceneLayer}>
        <ImmersiveScene
          performers={performers}
          extracting={state.phase === "extracting"}
          focusedId={focusedId}
          /**
           * `judging` is the ONLY phase with bubbles, straight off the contract
           * table, and it is stated as one derived expression so the table cannot
           * drift out of sync with a pile of conditions:
           *
           * - idle / extracting: nothing has been said yet — the bubbles would be
           *   six empty "…" pills decorating a ring that is meant to read as
           *   waiting.
           * - judging: the bubbles ARE the UI. There is deliberately no panel.
           * - summarizing / done: the summary panel now says all of it, merged and
           *   prioritised. Leaving them up is the "3D 气泡还全部亮着" pile-up —
           *   noise that also duplicates the result.
           * - error: only ever reached from a failed extraction (per-agent
           *   failures stay per-run and keep the phase moving), so there is by
           *   construction no commentary to lose here.
           *
           * Focus is orthogonal and handled inside the scene, so focusing a
           * reviewer mid-judging still silences the ring — the two rules stack.
           */
          showBubbles={state.phase === "judging"}
        />
      </div>

      <div className={styles.overlay}>
        {/* ① Title card */}
        <div className={`${styles.card} ${styles.titleCard}`}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>圆桌议会</h1>
            {state.round > 0 && <span className={styles.roundBadge}>第 {state.round} 轮</span>}
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
            {enabledAgents.length > 0 ? `${enabledAgents.length} 位评审待命` : "还没配置评审团"}
          </p>
        </div>

        {/* ② The LEFT column: input card, and under it whichever act the
            contract anchors left (extraction one-liner / solo focus panel).
            One flex column, so those acts stack UNDER the input card and share
            the same capped height instead of overlapping it — and so nothing on
            this side can ever drift over the right 65% where the focused
            character stands. */}
        <div className={styles.leftColumn}>
          {/* Input card — folds to a bar once grading runs AND for as long as any
              other act holds the stage (see `hostAct`); the bar is also the way
              back in for the revise round, and reopening it there sticks. */}
          <div
            className={`${styles.card} ${styles.inputCard} ${
              showInputs ? "" : styles.inputCardClosed
            }`}
          >
            <button
              type="button"
              className={styles.collapseToggle}
              onClick={toggleInputs}
              aria-expanded={showInputs}
            >
              <span>{showInputs ? "收起输入" : started ? "修改答案" : "展开输入"}</span>
              <ChevronIcon open={showInputs} />
            </button>

            {showInputs && (
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
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => {
                        setFocusedId(null);
                        onReset();
                      }}
                    >
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

          {/* Extraction: a one-line hint under the folded input card. Left, not
              centred — the scene already floats its own "要点抽取中…" marker over
              the ring, and a second centred notice would just be that sentence
              twice, in two places, over the characters. */}
          {stageView === "extracting" && (
            <div className={styles.notice}>
              <span className={styles.noticePulse} aria-hidden="true" />
              <p className={styles.noticeText}>正在从课堂笔记抽取要点清单…</p>
            </div>
          )}

          {/* Solo mode: LEFT-ANCHORED, per the contract. The camera has trucked
              this reviewer's face to ~65% of the viewport; the panel lives in the
              capped left column so the two can never share a pixel. Its chips
              follow directly underneath, in the same column. */}
          {stageView === "focus" && focused && (
            <div className={styles.focusSlot}>
              <FocusPanel
                performer={focused}
                error={state.runs[focused.id]?.error}
                onBack={() => setFocusedId(null)}
              />
              <div className={styles.focusChips}>
                <ReviewerChips
                  performers={performers}
                  focusedId={focusedId}
                  onFocus={setFocusedId}
                  label="切换评审"
                />
              </div>
            </div>
          )}
        </div>

        {/* ③ Centre stage — the summary act, and only the summary act. Every
            other panel is anchored left (see the contract at the top), so this
            slot is empty unless the producer is talking. */}
        <div className={styles.stageSlot}>
          {stageView === "summary" && (
            <>
              <SummaryStage
                text={state.summaryText}
                status={state.summaryStatus}
                aggregate={state.aggregate}
                collapsed={summaryCollapsed}
                onToggle={() => setSummaryCollapsed((v) => !v)}
              />
              <ReviewerChips
                performers={performers}
                focusedId={focusedId}
                onFocus={setFocusedId}
                label="逐位评审下钻"
              />
            </>
          )}
        </div>

        {/* ④ Bottom bar — judging progress rail (left/centre) + result CTA. */}
        <div className={styles.bottomBar}>
          <div className={styles.railWrap}>
            {showRail && (
              <ReviewerChips
                performers={performers}
                focusedId={focusedId}
                onFocus={setFocusedId}
                label="评审进度"
              />
            )}
          </div>
          {showResultButton && (
            <button type="button" className={styles.resultBtn} onClick={() => setModalOpen(true)}>
              查看完整结果
            </button>
          )}
        </div>
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
