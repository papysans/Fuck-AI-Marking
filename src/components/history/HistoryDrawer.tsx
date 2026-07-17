"use client";

import type { HistoryEntry } from "@/lib/history";
import styles from "./HistoryDrawer.module.css";

function scoreColor(score: number): string {
  if (score >= 85) return "var(--color-success)";
  if (score >= 60) return "var(--color-primary)";
  return "var(--color-secondary)";
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function summarize(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "（无题目）";
}

export function HistoryDrawer({
  open,
  entries,
  activeId,
  onClose,
  onLoad,
  onDelete,
  onClear,
  onNew,
}: {
  open: boolean;
  entries: HistoryEntry[];
  activeId?: string;
  onClose: () => void;
  onLoad: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onNew: () => void;
}) {
  return (
    <div className={`${styles.root} ${open ? styles.open : ""}`} aria-hidden={!open}>
      <div className={styles.overlay} onClick={onClose} />
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="历史记录"
      >
        <header className={styles.header}>
          <h2 className={styles.heading}>历史记录</h2>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.toolbar}>
          <button type="button" className={styles.toolBtn} onClick={onNew}>
            <PlusIcon />
            新建
          </button>
          <button
            type="button"
            className={styles.toolBtnDanger}
            onClick={onClear}
            disabled={entries.length === 0}
          >
            <TrashIcon />
            清空
          </button>
        </div>

        <div className={styles.list}>
          {entries.length === 0 ? (
            <p className={styles.empty}>还没有历史记录。完成一次评分后会自动保存。</p>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                className={`${styles.entry} ${e.id === activeId ? styles.entryActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.entryMain}
                  onClick={() => onLoad(e)}
                  title="载入并回看"
                >
                  <span className={styles.entryQuestion}>{summarize(e.question)}</span>
                  <span className={styles.entryMeta}>
                    <span className={styles.entryTime}>{formatTs(e.ts)}</span>
                    <span className={styles.entryRound}>第 {e.round} 轮</span>
                    <span
                      className={styles.entryScore}
                      style={{ color: scoreColor(e.median) }}
                    >
                      {e.median} 分
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.entryDelete}
                  onClick={() => onDelete(e.id)}
                  aria-label="删除此条"
                  title="删除此条"
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a1 1 0 01-1 1H7a1 1 0 01-1-1V7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
