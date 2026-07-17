import type { AgentConfig, ChatMessage, KeyPoint } from "./types";

/**
 * Prompt construction for the three grading stages.
 * Guidance baked in from research/llm-grader-best-practices.md:
 *  - evidence BEFORE label (anti-hallucination)
 *  - ternary labels, never a model-emitted score
 *  - ignore length/fluency/style; judge factual presence only
 *  - grade against exactly the provided key-point ids, no more/less
 */

// ---- Stage A: rubric extraction -------------------------------------------

const EXTRACT_SYSTEM = `你是一个严谨的评分要点抽取器。你的任务：从给定的「课堂笔记 / 参考资料」和「题目」中，抽取出一份"标准答案必须命中的原子要点清单"。

规则：
- 每个要点是一个可独立核查的原子命题，一句话表达。
- 拆分复合陈述（"X 因为 Y" 拆成两条）。要点之间不重叠。
- 只抽取与本题相关的知识/概念要点，不要包含书写、格式、字数等风格要求（除非题目明确要求）。
- 按重要性给每个要点一个整数权重 weight（1-5，默认 1；核心得分点给高权重）。
- 只输出严格 JSON，不要任何解释性文字或 markdown 代码围栏。

输出格式：
{"key_points":[{"id":"kp_1","text":"...","weight":2}]}`;

export function buildExtractionMessages(question: string, notes: string): ChatMessage[] {
  return [
    { role: "system", content: EXTRACT_SYSTEM },
    {
      role: "user",
      content: `【题目】\n${question.trim()}\n\n【课堂笔记 / 参考资料】\n${notes.trim()}\n\n请抽取原子要点清单，只输出 JSON。`,
    },
  ];
}

// ---- Stage B: coverage judging --------------------------------------------

const JUDGE_SYSTEM = `你是一个严格的、基于证据的评审员。给你一份固定的"要点清单"和"学生答案"，你要判定学生答案是否覆盖每一个要点。

铁律：
- 你必须且只能对给定的这些要点 id 返回判定，不得新增、不得遗漏、不得合并。
- 对每个要点，先在 "student_evidence" 中逐字引用（verbatim）学生答案里支撑该要点的原文片段；若不存在这样的片段，则置为 ""，且该要点 label 必须为 "missing"。
- 一个被提及但错误、或与其它内容自相矛盾的要点，是 "partial" 或 "missing"，绝不是 "covered"。
- 只判定"事实/概念是否出现且正确"。忽略答案的长度、流畅度、语气、书写风格——这些一律与判定无关。
- 每个要点的 reasoning 控制在 1-2 句。
- label 只能取 "covered"(完整正确命中) / "partial"(提到但不完整或不精确) / "missing"(缺失或错误)。

你的回答分两部分：
1) 先用中文写一段自然语言点评（面向学生，简明扼要地说命中了什么、漏了什么、哪里可以补）。
2) 然后另起一行输出一个被 <JUDGE_JSON> ... </JUDGE_JSON> 包裹的严格 JSON 块，格式：
<JUDGE_JSON>
{"results":[{"id":"kp_1","student_evidence":"...","reasoning":"...","label":"covered"}]}
</JUDGE_JSON>
JSON 块之外不要再出现第二个 JSON。`;

function keyPointsBlock(keyPoints: KeyPoint[]): string {
  return keyPoints
    .map((kp) => `- ${kp.id} (weight ${kp.weight}): ${kp.text}`)
    .join("\n");
}

/**
 * First-round judging messages for one agent.
 * roleHint (optional persona) is appended to the system prompt.
 */
export function buildJudgeMessages(
  agent: AgentConfig,
  keyPoints: KeyPoint[],
  question: string,
  answer: string,
): ChatMessage[] {
  const system = agent.roleHint
    ? `${JUDGE_SYSTEM}\n\n【额外视角】${agent.roleHint}`
    : JUDGE_SYSTEM;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `【题目】\n${question.trim()}\n\n【要点清单】\n${keyPointsBlock(
        keyPoints,
      )}\n\n【学生答案】\n${answer.trim()}\n\n请先写点评，再输出 <JUDGE_JSON> 块。`,
    },
  ];
}

/**
 * Follow-up judging for round N>1: the agent already has the prior messages in
 * context; we just append the revised answer and ask for a re-judge with
 * explicit "what changed" framing.
 */
export function buildRejudgeMessage(revisedAnswer: string): ChatMessage {
  return {
    role: "user",
    content: `我根据上一轮的反馈修改了答案。这是【修改后的答案】：\n${revisedAnswer.trim()}\n\n请对同一份要点清单重新判定，并在点评里明确指出：上一轮你标为 partial/missing 的要点，这次是否已经补上或修正。然后照旧输出 <JUDGE_JSON> 块。`,
  };
}

// ---- Summary agent ---------------------------------------------------------

const SUMMARY_SYSTEM = `你是评审团的"制作人"。多个评审模型各自对同一份答案做了逐要点判定。你的任务：把它们的判定归并成一份"面向学生、按优先级排序的修改清单"。

规则：
- 优先级：被越多评审共同判为 missing/partial 的要点越靠前（这些是任何 AI 判卷都可能扣分的客观缺陷）。
- 对每个要点，给出：要点是什么、为什么会被扣分、具体怎么补（给一句可直接写进答案的补充建议）。
- 如果各评审对某要点判定分歧较大，明确标注"评审存在分歧，建议重点核实"。
- 用中文，条理清晰，用有序列表。不要输出 JSON。`;

export function buildSummaryMessages(
  question: string,
  perAgentReports: { name: string; missing: string[]; partial: string[]; score: number }[],
): ChatMessage[] {
  const body = perAgentReports
    .map(
      (r) =>
        `### ${r.name}（评分 ${r.score}）\n漏点(missing): ${
          r.missing.length ? r.missing.join("; ") : "无"
        }\n不完整(partial): ${r.partial.length ? r.partial.join("; ") : "无"}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: SUMMARY_SYSTEM },
    {
      role: "user",
      content: `【题目】\n${question.trim()}\n\n【各评审的判定汇总】\n${body}\n\n请归并成一份按优先级排序的修改清单。`,
    },
  ];
}
