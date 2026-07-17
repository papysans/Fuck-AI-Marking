"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AgentConfig } from "@/lib/types";
import { loadAgents, saveAgents } from "@/lib/storage";
import { defaultAgents } from "@/lib/providers";
import { AgentConfigPanel } from "@/components/config/AgentConfigPanel";
import styles from "./settings.module.css";

export default function SettingsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>(() => defaultAgents());

  // Hydrate from localStorage after mount (keys live only in browser).
  useEffect(() => {
    setAgents(loadAgents());
  }, []);

  // Persist on change.
  useEffect(() => {
    saveAgents(agents);
  }, [agents]);

  return (
    <main className={styles.main}>
      <Link href="/" className={styles.back}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        返回评分
      </Link>

      <header className={styles.header}>
        <h1 className={styles.title}>配置评审团</h1>
        <p className={styles.subtitle}>
          增删评审、填入各厂商的 baseURL / API Key / model。配置会自动保存，返回评分页即可使用。
        </p>
      </header>

      <AgentConfigPanel agents={agents} onChange={setAgents} />

      <section className={styles.notes}>
        <div className={styles.note}>
          <h2 className={styles.noteTitle}>API Key 安全</h2>
          <p className={styles.noteText}>
            所有 API Key 只存放在你当前浏览器的 localStorage，不会上传或落到服务器。评分请求经
            <code className={styles.code}>/api/proxy</code>
            透明转发到各厂商 OpenAI 兼容 endpoint，代理仅用于构造上游请求头、绕开 CORS 并保证流式，
            <strong>不记录、不持久化、不回显</strong> 你的 Key。
          </p>
        </div>

        <div className={styles.note}>
          <h2 className={styles.noteTitle}>评分内核三段式</h2>
          <ol className={styles.noteList}>
            <li>
              <strong>要点抽取</strong>：从「题目 + 课堂笔记」抽出原子要点清单，所有评审共用同一份，保证同标准对比。
            </li>
            <li>
              <strong>逐点判定</strong>：每个评审 Agent 并发流式地对每个要点先给证据、再判 覆盖 / 部分 / 缺失；引不出证据即判缺失。
            </li>
            <li>
              <strong>确定性算分</strong>：分数由前端代码按要点权重计算得出，<strong>不由模型直接拍</strong>；再由议长 Agent 合议裁定，归并各评审的漏点成优先级清单。
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
