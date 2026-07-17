"use client";

import styles from "./ProblemInputs.module.css";

type Field = "question" | "notes" | "answer";

export function ProblemInputs({
  question,
  notes,
  answer,
  onChange,
  disabled,
}: {
  question: string;
  notes: string;
  answer: string;
  onChange: (field: Field, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.wrap} data-disabled={disabled ? "true" : "false"}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="problem-question">
          题目
        </label>
        <textarea
          id="problem-question"
          className={styles.textarea}
          value={question}
          disabled={disabled}
          placeholder="粘贴或输入题目内容，例如：简述光合作用的两个阶段及其产物。"
          onChange={(e) => onChange("question", e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="problem-notes">
          课堂笔记
        </label>
        <textarea
          id="problem-notes"
          className={styles.textarea}
          value={notes}
          disabled={disabled}
          placeholder="贴上相关的课堂笔记或标准资料，评审会据此提炼要点。"
          onChange={(e) => onChange("notes", e.target.value)}
        />
        <p className={styles.hint}>
          评审会从笔记里抽取要点清单，逐条核对你的答案是否命中
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="problem-answer">
          我的答案
        </label>
        <textarea
          id="problem-answer"
          className={styles.textarea}
          value={answer}
          disabled={disabled}
          placeholder="写下你的作答，评审将逐条比对要点给出反馈。"
          onChange={(e) => onChange("answer", e.target.value)}
        />
      </div>
    </div>
  );
}
