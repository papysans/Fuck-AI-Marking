import type { KeyPoint } from "./types";

/**
 * localStorage-backed grading history (multi-problem management).
 *
 * SSR-safe: every access guards `typeof window`. Stores a capped array of
 * lightweight snapshots — just enough to re-render a read-only playback of a
 * past round without re-calling any model.
 */

const KEY = "agb.history.v1";
const MAX_ENTRIES = 30;

/** Per-agent slice of a snapshot (mirrors the display fields of AgentGrade). */
export interface HistoryAgent {
  name: string;
  accentIndex: number;
  score: number;
  invalid: boolean;
  missing: KeyPoint[];
  partial: KeyPoint[];
  commentary: string;
}

export interface HistoryEntry {
  id: string;
  ts: number;
  question: string;
  notes: string;
  answer: string;
  mode: string;
  round: number;
  agents: HistoryAgent[];
  median: number;
  unionMissing: KeyPoint[];
  disagreements: KeyPoint[];
  summaryText: string;
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/**
 * Append a snapshot, returning the new list.
 *
 * Dedup strategy: if the most recent entry has the same (trimmed) question, we
 * treat this as another round of the SAME problem session and replace that
 * entry in place (latest round wins, keeping its id). Otherwise we prepend a
 * new entry. This keeps one row per problem across multi-round revisions while
 * still creating a fresh row when the user switches to a different question.
 */
export function appendHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = loadHistory();
  const q = entry.question.trim();
  if (list.length > 0 && list[0].question.trim() === q) {
    const next = [{ ...entry, id: list[0].id }, ...list.slice(1)];
    saveHistory(next);
    return next.slice(0, MAX_ENTRIES);
  }
  const next = [entry, ...list].slice(0, MAX_ENTRIES);
  saveHistory(next);
  return next;
}

export function removeHistory(id: string): HistoryEntry[] {
  const next = loadHistory().filter((e) => e.id !== id);
  saveHistory(next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  saveHistory([]);
  return [];
}
