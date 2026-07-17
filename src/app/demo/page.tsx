"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./demo.module.css";
import {
  ImmersiveScene,
  type ScenePerformer,
} from "@/components/scene/ImmersiveScene";

/**
 * Test bench for <ImmersiveScene>. Not wired to real grading — it hardcodes
 * mock performers and fakes a streaming run so the stage (ring layout, poses,
 * head chat bubbles, dynamic count) can be eyeballed / screenshotted.
 */

// Fake streamed review scripts (different per reviewer) + final mock scores.
const SCRIPTS: { text: string; score: number }[] = [
  {
    text:
      "正在核对要点覆盖…\n要点1「定义准确」：已命中，引用清晰。\n要点2「因果链」：部分覆盖，缺少中间推导。\n要点3「反例」：未提及 → 缺失。\n综合：论证骨架在，但关键推导缺环。",
    score: 78,
  },
  {
    text:
      "逐点判定中…\n要点1：覆盖。\n要点2：缺失，答案跳过了机制解释。\n要点3：缺失。\n要点4：部分。\n多处核心机制未答到，覆盖度偏低。",
    score: 46,
  },
  {
    text:
      "评审进行中…\n要点1：覆盖，且有额外例证。\n要点2：覆盖。\n要点3：部分，术语略不精确。\n整体覆盖良好，细节可再打磨。",
    score: 84,
  },
  {
    text:
      "开始比对…\n要点1：部分。\n要点2：缺失。\n要点3：缺失。\n答案偏离笔记要点较多，需要大幅补漏。",
    score: 39,
  },
];

const NAMES = ["DeepSeek · 严", "豆包 · 中", "OpenAI · 宽", "Kimi · 补"];

function makePerformer(i: number): ScenePerformer {
  return {
    id: `agent-${i}`,
    name: NAMES[i % NAMES.length],
    accentIndex: (i % 6) + 1,
    status: "pending",
    commentary: "",
  };
}

export default function DemoPage() {
  const [performers, setPerformers] = useState<ScenePerformer[]>(() =>
    [0, 1, 2].map(makePerformer),
  );
  const [bloom, setBloom] = useState(true);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setRunning(false);
    setPerformers((prev) =>
      prev.map((p) => ({ ...p, status: "pending", commentary: "", score: undefined })),
    );
  }, [clearTimers]);

  // Simulate a concurrent streaming grade: all → streaming, append fake tokens
  // at different paces, then settle to done with mock (high/low) scores.
  const simulate = useCallback(() => {
    clearTimers();
    setRunning(true);
    setPerformers((prev) =>
      prev.map((p) => ({ ...p, status: "streaming", commentary: "", score: undefined })),
    );

    performers.forEach((p, i) => {
      const script = SCRIPTS[i % SCRIPTS.length];
      let pos = 0;
      const step = 2 + (i % 3); // chars per tick, staggered pace
      const interval = setInterval(() => {
        pos += step;
        const slice = script.text.slice(0, pos);
        setPerformers((prev) =>
          prev.map((q) => (q.id === p.id ? { ...q, commentary: slice } : q)),
        );
        if (pos >= script.text.length) {
          clearInterval(interval);
          setPerformers((prev) =>
            prev.map((q) =>
              q.id === p.id
                ? { ...q, status: "done", commentary: script.text, score: script.score }
                : q,
            ),
          );
        }
      }, 90 + i * 25);
      timers.current.push(interval);
    });
  }, [performers, clearTimers]);

  const addRobot = () =>
    setPerformers((prev) =>
      prev.length >= 6 ? prev : [...prev, makePerformer(prev.length)],
    );
  const removeRobot = () =>
    setPerformers((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));

  return (
    <div className={styles.root}>
      <div className={styles.canvasLayer}>
        <ImmersiveScene performers={performers} extracting={false} bloom={bloom} />
      </div>

      <div className={styles.uiLayer}>
        <div className={styles.topRow}>
          <section className={`${styles.glassCard} ${styles.titleCard}`}>
            <p className={styles.eyebrow}>Immersive Test Bench</p>
            <h1 className={styles.title}>评分录音棚 · 测试台</h1>
            <p className={styles.subtitle}>
              数据驱动的 &lt;ImmersiveScene&gt; 预览：机器人围圈面对面「争论」、缓慢转台、
              头顶对话框流式点评。下方按钮模拟一次评分，并可增删机器人验证围圈自适应。
            </p>
          </section>
        </div>

        <div className={styles.bottomRow}>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setBloom((b) => !b)}
              aria-pressed={bloom}
            >
              Bloom：{bloom ? "开" : "关"}
            </button>
            <button type="button" className={styles.toggle} onClick={removeRobot}>
              − 机器人
            </button>
            <span className={styles.count}>{performers.length}</span>
            <button type="button" className={styles.toggle} onClick={addRobot}>
              + 机器人
            </button>
            <button type="button" className={styles.toggle} onClick={reset}>
              重置
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={simulate}
              disabled={running}
            >
              ▶ 模拟评分
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
