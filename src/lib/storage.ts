import type { AgentConfig } from "./types";
import { defaultAgents } from "./providers";

/**
 * localStorage persistence for agent configs. Keys live only in the browser.
 * SSR-safe: all access guards `typeof window`.
 */
const KEY = "agb.agents.v1";

export function loadAgents(): AgentConfig[] {
  if (typeof window === "undefined") return defaultAgents();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultAgents();
    const parsed = JSON.parse(raw) as AgentConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultAgents();
    return parsed;
  } catch {
    return defaultAgents();
  }
}

export function saveAgents(agents: AgentConfig[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(agents));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}
