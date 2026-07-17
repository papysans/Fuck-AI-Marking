import { z } from "zod";

/**
 * Core domain types + runtime schemas.
 *
 * Design note: the LLM never emits the final numeric score. It only classifies
 * each key point (Stage B). The score is computed deterministically in code
 * (see grading.ts). Schemas here validate the model's structured output before
 * we trust it.
 */

// ---------------------------------------------------------------------------
// Agent configuration (persisted in localStorage; keys never leave the browser
// except as a per-request payload to our own /api/proxy).
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** stable client-generated id */
  id: string;
  /** display name, e.g. "DeepSeek 评审" */
  name: string;
  /** OpenAI-compatible base URL, e.g. https://api.deepseek.com */
  baseUrl: string;
  /** provider API key — held only in the browser */
  apiKey: string;
  /** model id / endpoint id */
  model: string;
  /** 1-based index into the agent "voice" accent palette (--agent-N) */
  accentIndex: number;
  /** whether this agent participates in grading */
  enabled: boolean;
  /** optional persona/emphasis appended to the judging system prompt */
  roleHint?: string;
}

export type CoverageLabel = "covered" | "partial" | "missing";

// ---------------------------------------------------------------------------
// Stage A — rubric extraction output
// ---------------------------------------------------------------------------

export const KeyPointSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  weight: z.number().int().min(1).max(5).default(1),
});

export const KeyPointsSchema = z.object({
  key_points: z.array(KeyPointSchema).min(1),
});

export type KeyPoint = z.infer<typeof KeyPointSchema>;

// ---------------------------------------------------------------------------
// Stage B — per-key-point judging output
// ---------------------------------------------------------------------------

export const JudgmentSchema = z.object({
  id: z.string().min(1),
  student_evidence: z.string(),
  reasoning: z.string(),
  label: z.enum(["covered", "partial", "missing"]),
});

export const JudgeResultSchema = z.object({
  results: z.array(JudgmentSchema).min(1),
});

export type Judgment = z.infer<typeof JudgmentSchema>;

// ---------------------------------------------------------------------------
// Stage C — computed grade (in code, not from the model)
// ---------------------------------------------------------------------------

export interface GradeBreakdown {
  covered: number;
  partial: number;
  missing: number;
  total: number;
}

export interface AgentGrade {
  agentId: string;
  agentName: string;
  accentIndex: number;
  /** 0-100, computed from judgments + weights */
  score: number;
  breakdown: GradeBreakdown;
  judgments: Judgment[];
  /** key points this agent judged missing (with their text for display) */
  missing: KeyPoint[];
  /** key points this agent judged partial */
  partial: KeyPoint[];
  /** raw streamed commentary (natural language before the JSON block) */
  commentary: string;
  /** true if the JSON block failed validation and this agent is uncounted */
  invalid?: boolean;
}

// ---------------------------------------------------------------------------
// Chat message shape (OpenAI-compatible)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Payload the browser sends to /api/proxy for a streaming completion. */
export interface ProxyRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** ask upstream for a JSON object response where supported */
  jsonMode?: boolean;
}
