import type { AgentConfig } from "./types";

/**
 * Preset provider templates. All three speak the OpenAI-compatible
 * /chat/completions protocol, so a single streaming client covers them.
 * Keys are intentionally blank — the user fills them in the UI.
 */
export interface ProviderPreset {
  name: string;
  baseUrl: string;
  model: string;
  /** hint shown in the config UI about where the model id comes from */
  modelHint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    modelHint: "deepseek-chat 或 deepseek-reasoner",
  },
  {
    name: "豆包 (火山方舟)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    modelHint: "填写你的方舟推理接入点 Endpoint ID (ep-...)",
  },
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    modelHint: "gpt-4o / gpt-4o-mini 等",
  },
];

let counter = 0;
/** id generator that avoids Math.random/Date for SSR determinism concerns */
function nextId(): string {
  counter += 1;
  return `agent_${counter}_${counter * 2654435761 % 100000}`;
}

/** Build the default trio of evaluator agents (empty keys, sequential accents). */
export function defaultAgents(): AgentConfig[] {
  return PROVIDER_PRESETS.map((p, i) => ({
    id: nextId(),
    name: `${p.name} 评审`,
    baseUrl: p.baseUrl,
    apiKey: "",
    model: p.model,
    accentIndex: i + 1,
    enabled: true,
  }));
}

export function makeAgentFromPreset(preset: ProviderPreset, accentIndex: number): AgentConfig {
  return {
    id: nextId(),
    name: `${preset.name} 评审`,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.model,
    accentIndex,
    enabled: true,
  };
}

export function makeBlankAgent(accentIndex: number): AgentConfig {
  return {
    id: nextId(),
    name: "新评审 Agent",
    baseUrl: "",
    apiKey: "",
    model: "",
    accentIndex,
    enabled: true,
  };
}
