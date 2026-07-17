import {
  JudgeResultSchema,
  KeyPointsSchema,
  type AgentGrade,
  type CoverageLabel,
  type Judgment,
  type KeyPoint,
} from "./types";

/**
 * Deterministic scoring + parsing helpers.
 * The model's number is never trusted; we compute from ternary labels.
 */

const LABEL_VALUE: Record<CoverageLabel, number> = {
  covered: 1,
  partial: 0.5,
  missing: 0,
};

// ---- extraction parsing ----------------------------------------------------

/** Strip markdown code fences and grab the first {...} JSON object. */
function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}

/** Parse Stage A output into key points. Throws on unrecoverable failure. */
export function parseKeyPoints(raw: string): KeyPoint[] {
  const json = extractJsonObject(raw);
  if (!json) throw new Error("要点抽取未返回可解析的 JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("要点抽取 JSON 解析失败");
  }
  const result = KeyPointsSchema.safeParse(parsed);
  if (!result.success) throw new Error("要点抽取 JSON 不符合结构");
  return result.data.key_points;
}

// ---- judging parsing -------------------------------------------------------

/** Split an agent's streamed reply into human commentary + the JUDGE_JSON body. */
export function splitCommentaryAndJson(raw: string): {
  commentary: string;
  jsonBody: string | null;
} {
  const m = raw.match(/<JUDGE_JSON>([\s\S]*?)<\/JUDGE_JSON>/i);
  if (m) {
    const commentary = raw.slice(0, m.index).trim();
    return { commentary, jsonBody: m[1].trim() };
  }
  // Fallback: no closing tag yet (mid-stream) or model ignored the wrapper.
  const openIdx = raw.search(/<JUDGE_JSON>/i);
  if (openIdx !== -1) {
    return { commentary: raw.slice(0, openIdx).trim(), jsonBody: null };
  }
  return { commentary: raw.trim(), jsonBody: null };
}

/**
 * Validate judgments against the fixed rubric and the student's answer.
 * - ids must match the rubric exactly (missing ids are filled as `missing`)
 * - evidence must be a verbatim substring of the answer, else downgrade to missing
 * Returns a normalized judgment list aligned to the rubric order.
 */
export function normalizeJudgments(
  rawJudgments: Judgment[],
  keyPoints: KeyPoint[],
  answer: string,
): Judgment[] {
  const byId = new Map(rawJudgments.map((j) => [j.id, j]));
  const haystack = answer.replace(/\s+/g, "");
  return keyPoints.map((kp) => {
    const j = byId.get(kp.id);
    if (!j) {
      return {
        id: kp.id,
        student_evidence: "",
        reasoning: "模型未对该要点作出判定，按缺失处理。",
        label: "missing" as CoverageLabel,
      };
    }
    // Anti-hallucination: non-missing labels require a real substring quote.
    if (j.label !== "missing") {
      const ev = j.student_evidence.replace(/\s+/g, "");
      if (ev.length === 0 || !haystack.includes(ev)) {
        return {
          ...j,
          label: "partial" as CoverageLabel,
          reasoning: `${j.reasoning}（注：引用证据未在答案中逐字命中，已降级）`,
        };
      }
    }
    return j;
  });
}

/** Weighted deterministic score in [0,100]. */
export function computeScore(judgments: Judgment[], keyPoints: KeyPoint[]): number {
  const weightById = new Map(keyPoints.map((kp) => [kp.id, kp.weight]));
  let num = 0;
  let den = 0;
  for (const j of judgments) {
    const w = weightById.get(j.id) ?? 1;
    den += w;
    num += w * LABEL_VALUE[j.label];
  }
  if (den === 0) return 0;
  return Math.round((100 * num) / den);
}

/** Build the full per-agent grade from a completed raw reply. */
export function buildAgentGrade(
  agentId: string,
  agentName: string,
  accentIndex: number,
  raw: string,
  keyPoints: KeyPoint[],
  answer: string,
): AgentGrade {
  const { commentary, jsonBody } = splitCommentaryAndJson(raw);
  const base = {
    agentId,
    agentName,
    accentIndex,
    commentary: commentary || raw.trim(),
  };

  if (!jsonBody) {
    return { ...base, ...emptyGrade(keyPoints), invalid: true };
  }
  const json = extractJsonObject(jsonBody);
  if (!json) return { ...base, ...emptyGrade(keyPoints), invalid: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ...base, ...emptyGrade(keyPoints), invalid: true };
  }
  const result = JudgeResultSchema.safeParse(parsed);
  if (!result.success) return { ...base, ...emptyGrade(keyPoints), invalid: true };

  const judgments = normalizeJudgments(result.data.results, keyPoints, answer);
  const score = computeScore(judgments, keyPoints);
  const kpById = new Map(keyPoints.map((kp) => [kp.id, kp]));
  const missing = judgments
    .filter((j) => j.label === "missing")
    .map((j) => kpById.get(j.id))
    .filter((kp): kp is KeyPoint => Boolean(kp));
  const partial = judgments
    .filter((j) => j.label === "partial")
    .map((j) => kpById.get(j.id))
    .filter((kp): kp is KeyPoint => Boolean(kp));

  return {
    ...base,
    score,
    breakdown: {
      covered: judgments.filter((j) => j.label === "covered").length,
      partial: partial.length,
      missing: missing.length,
      total: keyPoints.length,
    },
    judgments,
    missing,
    partial,
  };
}

function emptyGrade(keyPoints: KeyPoint[]) {
  return {
    score: 0,
    breakdown: { covered: 0, partial: 0, missing: keyPoints.length, total: keyPoints.length },
    judgments: [] as Judgment[],
    missing: [] as KeyPoint[],
    partial: [] as KeyPoint[],
  };
}

// ---- ensemble aggregation --------------------------------------------------

export interface Aggregate {
  /** median score across valid agents */
  medianScore: number;
  /** union-of-missing: key points ANY valid agent flagged missing */
  unionMissing: KeyPoint[];
  /** key points where agents disagreed (some covered, some not) */
  disagreements: KeyPoint[];
}

export function aggregate(grades: AgentGrade[], keyPoints: KeyPoint[]): Aggregate {
  const valid = grades.filter((g) => !g.invalid);
  const scores = valid.map((g) => g.score).sort((a, b) => a - b);
  const medianScore =
    scores.length === 0
      ? 0
      : scores.length % 2
        ? scores[(scores.length - 1) / 2]
        : Math.round((scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2);

  const kpById = new Map(keyPoints.map((kp) => [kp.id, kp]));
  const unionMissingIds = new Set<string>();
  const disagreeIds = new Set<string>();

  for (const kp of keyPoints) {
    const labels: CoverageLabel[] = [];
    for (const g of valid) {
      const j = g.judgments.find((x) => x.id === kp.id);
      if (j) labels.push(j.label);
    }
    if (labels.length === 0) continue;
    if (labels.some((l) => l === "missing")) unionMissingIds.add(kp.id);
    const hasCovered = labels.includes("covered");
    const hasGap = labels.some((l) => l !== "covered");
    if (hasCovered && hasGap) disagreeIds.add(kp.id);
  }

  const pick = (ids: Set<string>) =>
    [...ids].map((id) => kpById.get(id)).filter((kp): kp is KeyPoint => Boolean(kp));

  return {
    medianScore,
    unionMissing: pick(unionMissingIds),
    disagreements: pick(disagreeIds),
  };
}
