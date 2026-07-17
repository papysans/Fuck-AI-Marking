import type { KeyPoint } from "./types";

/**
 * Markdown report builder for a completed grading round.
 *
 * Pure/deterministic: takes a plain snapshot of the current results and renders
 * a structured Markdown document. No DOM / browser APIs here so it stays easy to
 * unit-test and reuse for both live results and history playback.
 */

export interface ReportAgent {
  name: string;
  score: number;
  invalid?: boolean;
  missing: KeyPoint[];
  partial: KeyPoint[];
  commentary: string;
}

export interface ReportInput {
  question: string;
  notes: string;
  answer: string;
  round: number;
  agents: ReportAgent[];
  median: number;
  unionMissing: KeyPoint[];
  disagreements: KeyPoint[];
  summaryText: string;
}

function keyPointLines(items: KeyPoint[]): string {
  if (items.length === 0) return "- 无\n";
  return items.map((kp) => `- ${kp.text}（权重 ${kp.weight}）`).join("\n") + "\n";
}

/** Render the full grading report as Markdown. */
export function buildMarkdownReport(input: ReportInput): string {
  const {
    question,
    notes,
    answer,
    round,
    agents,
    median,
    unionMissing,
    disagreements,
    summaryText,
  } = input;

  const out: string[] = [];
  out.push(`# 评分报告（第 ${round} 轮）`);
  out.push("");
  out.push(`> 生成时间：${new Date().toLocaleString()}`);
  out.push(`> 评审团中位分：**${median}**`);
  out.push("");

  out.push("## 题目");
  out.push("");
  out.push(question.trim() || "（空）");
  out.push("");

  out.push("## 课堂笔记");
  out.push("");
  out.push(notes.trim() || "（空）");
  out.push("");

  out.push("## 我的答案");
  out.push("");
  out.push(answer.trim() || "（空）");
  out.push("");

  out.push("## 各评审打分");
  out.push("");
  for (const a of agents) {
    out.push(`### ${a.name} — ${a.invalid ? "解析失败（未计入）" : a.score}`);
    out.push("");
    if (a.commentary.trim()) {
      out.push(a.commentary.trim());
      out.push("");
    }
    if (!a.invalid) {
      out.push("**缺失要点**");
      out.push("");
      out.push(keyPointLines(a.missing).trimEnd());
      out.push("");
      out.push("**不完整要点**");
      out.push("");
      out.push(keyPointLines(a.partial).trimEnd());
      out.push("");
    }
  }

  out.push("## 合议裁定");
  out.push("");
  out.push(summaryText.trim() || "（无）");
  out.push("");

  out.push("## 全员补漏清单（任一评审判缺失）");
  out.push("");
  out.push(keyPointLines(unionMissing).trimEnd());
  out.push("");

  out.push("## 评审分歧要点（建议重点核实）");
  out.push("");
  out.push(keyPointLines(disagreements).trimEnd());
  out.push("");

  return out.join("\n");
}

/** Slugify a question prefix + timestamp into a safe .md filename. */
export function reportFileName(question: string): string {
  const prefix = question
    .trim()
    .slice(0, 20)
    .replace(/[\s\\/:*?"<>|]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix || "评分报告"}-${stamp}.md`;
}
