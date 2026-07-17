"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentConfig, AgentGrade, ChatMessage, KeyPoint } from "@/lib/types";
import { streamChat } from "@/lib/openaiStream";
import {
  buildExtractionMessages,
  buildJudgeMessages,
  buildRejudgeMessage,
  buildSummaryMessages,
} from "@/lib/prompts";
import { aggregate, buildAgentGrade, parseKeyPoints, type Aggregate } from "@/lib/grading";

export type Phase = "idle" | "extracting" | "judging" | "summarizing" | "done" | "error";
export type RunStatus = "pending" | "streaming" | "done" | "error";

export interface AgentRunView {
  status: RunStatus;
  commentary: string;
  grade?: AgentGrade;
  error?: string;
}

export interface GradeState {
  phase: Phase;
  round: number;
  keyPoints: KeyPoint[];
  runs: Record<string, AgentRunView>;
  summaryText: string;
  summaryStatus: RunStatus | "idle";
  aggregate?: Aggregate;
  error?: string;
}

const INITIAL: GradeState = {
  phase: "idle",
  round: 0,
  keyPoints: [],
  runs: {},
  summaryText: "",
  summaryStatus: "idle",
};

export function useStreamingGrade() {
  const [state, setState] = useState<GradeState>(INITIAL);

  // Per-agent conversation history for multi-round context.
  const messagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const keyPointsRef = useRef<KeyPoint[]>([]);
  const agentsRef = useRef<AgentConfig[]>([]);
  const questionRef = useRef("");
  const answerRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  const patchRun = useCallback((id: string, patch: Partial<AgentRunView>) => {
    setState((s) => ({ ...s, runs: { ...s.runs, [id]: { ...s.runs[id], ...patch } } }));
  }, []);

  /** Judge one agent (round 1 or re-judge), streaming into its run view. */
  const judgeOne = useCallback(
    async (agent: AgentConfig, followUp: ChatMessage | null, answer: string) => {
      const prior = messagesRef.current.get(agent.id) ?? [];
      const messages: ChatMessage[] = followUp
        ? [...prior, followUp]
        : buildJudgeMessages(agent, keyPointsRef.current, questionRef.current, answer);

      patchRun(agent.id, { status: "streaming", commentary: "", grade: undefined, error: undefined });
      try {
        const raw = await streamChat(
          {
            baseUrl: agent.baseUrl,
            apiKey: agent.apiKey,
            model: agent.model,
            messages,
            temperature: 0,
          },
          {
            signal: abortRef.current?.signal,
            onDelta: (_d, full) => {
              const before = full.split(/<JUDGE_JSON>/i)[0];
              patchRun(agent.id, { commentary: before.trim() });
            },
          },
        );
        const grade = buildAgentGrade(
          agent.id,
          agent.name,
          agent.accentIndex,
          raw,
          keyPointsRef.current,
          answer,
        );
        messagesRef.current.set(agent.id, [...messages, { role: "assistant", content: raw }]);
        patchRun(agent.id, { status: "done", commentary: grade.commentary, grade });
        return grade;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "评分失败";
        patchRun(agent.id, { status: "error", error: msg });
        return null;
      }
    },
    [patchRun],
  );

  /** Run the summary ("producer") pass over all valid grades. */
  const runSummary = useCallback(async (grades: AgentGrade[], summarizer: AgentConfig) => {
    const valid = grades.filter((g) => !g.invalid);
    if (valid.length === 0) {
      setState((s) => ({ ...s, summaryStatus: "error", summaryText: "没有可用的评审结果可供汇总。" }));
      return;
    }
    const reports = valid.map((g) => ({
      name: g.agentName,
      score: g.score,
      missing: g.missing.map((k) => k.text),
      partial: g.partial.map((k) => k.text),
    }));
    setState((s) => ({ ...s, phase: "summarizing", summaryStatus: "streaming", summaryText: "" }));
    try {
      await streamChat(
        {
          baseUrl: summarizer.baseUrl,
          apiKey: summarizer.apiKey,
          model: summarizer.model,
          messages: buildSummaryMessages(questionRef.current, reports),
          temperature: 0.2,
        },
        {
          signal: abortRef.current?.signal,
          onDelta: (_d, full) => setState((s) => ({ ...s, summaryText: full })),
        },
      );
      setState((s) => ({ ...s, summaryStatus: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "汇总失败";
      setState((s) => ({ ...s, summaryStatus: "error", summaryText: `汇总失败：${msg}` }));
    }
  }, []);

  /** Full first-round grade: extract → judge (concurrent) → aggregate → summary. */
  const run = useCallback(
    async (question: string, notes: string, answer: string, agents: AgentConfig[]) => {
      const enabled = agents.filter((a) => a.enabled && a.apiKey && a.model && a.baseUrl);
      if (enabled.length === 0) {
        setState({ ...INITIAL, phase: "error", error: "没有可用的评审 Agent（需填好 baseURL / Key / model）。" });
        return;
      }

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      messagesRef.current.clear();
      agentsRef.current = enabled;
      questionRef.current = question;
      answerRef.current = answer;

      setState({
        ...INITIAL,
        phase: "extracting",
        round: 1,
        runs: Object.fromEntries(enabled.map((a) => [a.id, { status: "pending", commentary: "" }])),
      });

      // Stage A — extraction (use first enabled agent as extractor).
      let keyPoints: KeyPoint[];
      try {
        const raw = await streamChat(
          {
            baseUrl: enabled[0].baseUrl,
            apiKey: enabled[0].apiKey,
            model: enabled[0].model,
            messages: buildExtractionMessages(question, notes),
            temperature: 0,
          },
          { signal: abortRef.current.signal },
        );
        keyPoints = parseKeyPoints(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "要点抽取失败";
        setState((s) => ({ ...s, phase: "error", error: `要点抽取失败：${msg}` }));
        return;
      }
      keyPointsRef.current = keyPoints;
      setState((s) => ({ ...s, phase: "judging", keyPoints }));

      // Stage B — judge all agents concurrently.
      const grades = await Promise.all(enabled.map((a) => judgeOne(a, null, answer)));
      const valid = grades.filter((g): g is AgentGrade => Boolean(g));

      // Stage C — aggregate.
      const agg = aggregate(valid, keyPoints);
      setState((s) => ({ ...s, aggregate: agg }));

      // Summary.
      await runSummary(valid, enabled[0]);
      setState((s) => ({ ...s, phase: "done" }));
    },
    [judgeOne, runSummary],
  );

  /** Round N>1 — re-judge with the revised answer using each agent's context. */
  const revise = useCallback(
    async (revisedAnswer: string) => {
      const enabled = agentsRef.current;
      if (enabled.length === 0 || keyPointsRef.current.length === 0) return;
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      answerRef.current = revisedAnswer;

      setState((s) => ({
        ...s,
        phase: "judging",
        round: s.round + 1,
        summaryText: "",
        summaryStatus: "idle",
        aggregate: undefined,
        runs: Object.fromEntries(
          enabled.map((a) => [a.id, { status: "pending" as RunStatus, commentary: "" }]),
        ),
      }));

      const followUp = buildRejudgeMessage(revisedAnswer);
      const grades = await Promise.all(enabled.map((a) => judgeOne(a, followUp, revisedAnswer)));
      const valid = grades.filter((g): g is AgentGrade => Boolean(g));
      const agg = aggregate(valid, keyPointsRef.current);
      setState((s) => ({ ...s, aggregate: agg }));
      await runSummary(valid, enabled[0]);
      setState((s) => ({ ...s, phase: "done" }));
    },
    [judgeOne, runSummary],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { state, run, revise, reset };
}
