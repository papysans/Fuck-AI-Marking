"use client";

import { useState, type CSSProperties } from "react";
import type { AgentConfig } from "@/lib/types";
import {
  PROVIDER_PRESETS,
  makeAgentFromPreset,
  makeBlankAgent,
} from "@/lib/providers";
import styles from "./AgentConfigPanel.module.css";

type EditableField = "name" | "baseUrl" | "model" | "apiKey" | "roleHint";

interface AccentStyle extends CSSProperties {
  "--accent": string;
}

function ChevronIcon() {
  return (
    <svg
      className={styles.chevron}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4h10M6.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M5 4l.5 8a1 1 0 001 1h3a1 1 0 001-1L11 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgentConfigPanel({
  agents,
  onChange,
}: {
  agents: AgentConfig[];
  onChange: (next: AgentConfig[]) => void;
}) {
  const [open, setOpen] = useState(true);

  const enabledCount = agents.filter((a) => a.enabled).length;

  function updateField(id: string, field: EditableField, value: string) {
    onChange(
      agents.map((a) => (a.id === id ? { ...a, [field]: value } : a)),
    );
  }

  function updateEnabled(id: string, enabled: boolean) {
    onChange(agents.map((a) => (a.id === id ? { ...a, enabled } : a)));
  }

  function removeAgent(id: string) {
    onChange(agents.filter((a) => a.id !== id));
  }

  function addAgent(next: AgentConfig) {
    onChange([...agents, next]);
  }

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}>
          <ChevronIcon />
        </span>
        <h3 className={styles.title}>评审团配置</h3>
        <span className={styles.count}>
          已启用 {enabledCount} / 共 {agents.length}
        </span>
      </button>

      {open && (
        <>
          <p className={styles.notice}>
            API Key 只保存在你本机浏览器（localStorage），每次评分随请求发送，不会存到服务器。
          </p>

          <div className={styles.list}>
            {agents.map((agent) => {
              const accentStyle: AccentStyle = {
                "--accent": `var(--agent-${agent.accentIndex})`,
              };
              return (
                <div key={agent.id} className={styles.card} style={accentStyle}>
                  <div className={styles.cardTop}>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={agent.enabled}
                        onChange={(e) => updateEnabled(agent.id, e.target.checked)}
                      />
                      <span className={styles.track} aria-hidden="true" />
                      <span className={styles.knob} aria-hidden="true" />
                    </label>
                    <span className={styles.swatch} aria-hidden="true" />
                    <input
                      className={`${styles.input} ${styles.nameInput}`}
                      value={agent.name}
                      placeholder="评审名称"
                      onChange={(e) => updateField(agent.id, "name", e.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.delete}
                      onClick={() => removeAgent(agent.id)}
                      aria-label={`删除 ${agent.name}`}
                      title="删除该评审"
                    >
                      <TrashIcon />
                    </button>
                  </div>

                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Base URL</span>
                      <input
                        className={styles.input}
                        value={agent.baseUrl}
                        placeholder="https://api.deepseek.com"
                        onChange={(e) => updateField(agent.id, "baseUrl", e.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Model</span>
                      <input
                        className={styles.input}
                        value={agent.model}
                        placeholder="deepseek-chat"
                        onChange={(e) => updateField(agent.id, "model", e.target.value)}
                      />
                    </div>
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <span className={styles.fieldLabel}>API Key</span>
                      <input
                        className={styles.input}
                        type="password"
                        value={agent.apiKey}
                        placeholder="sk-... 仅存于浏览器"
                        onChange={(e) => updateField(agent.id, "apiKey", e.target.value)}
                      />
                    </div>
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                      <span className={styles.fieldLabel}>视角提示（可选）</span>
                      <input
                        className={styles.input}
                        value={agent.roleHint ?? ""}
                        placeholder="可选：给该评审一个视角，如'从严评分'"
                        onChange={(e) => updateField(agent.id, "roleHint", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.actions}>
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={styles.addBtn}
                onClick={() =>
                  addAgent(makeAgentFromPreset(preset, (agents.length % 6) + 1))
                }
              >
                + {preset.name}
              </button>
            ))}
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => addAgent(makeBlankAgent((agents.length % 6) + 1))}
            >
              + 空白
            </button>
          </div>
        </>
      )}
    </div>
  );
}
