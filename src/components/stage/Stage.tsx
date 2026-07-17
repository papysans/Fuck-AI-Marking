"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { SpriteCharacter, type CharacterStatus } from "./SpriteCharacter";
import { Equalizer } from "./Equalizer";
import styles from "./Stage.module.css";

// The single shared WebGL context lives here. Vanilla Three.js can't SSR
// (needs the DOM/WebGL), so load it client-only. All robots render into this
// one canvas, drawn imperatively (no react-three-fiber / drei).
const StageCanvas = dynamic(() => import("./StageCanvas"), { ssr: false });

export type { CharacterStatus };

export interface Performer {
  id: string;
  name: string;
  accentIndex: number;
  status: CharacterStatus;
  score?: number;
}

/**
 * The "stage": a Spider-Verse comic panel of evaluator characters. Each performs
 * (bobs on stepped low-fps poses + equalizer) while its grading streams. Radial
 * action lines and livelier halftone dots kick in while judging; a POW! star
 * bursts behind the score on reveal. This is the spectacle layer; the readable
 * results live in the Bento cards below it.
 */
export function Stage({
  performers,
  extracting,
}: {
  performers: Performer[];
  extracting: boolean;
}) {
  const judging = extracting || performers.some((p) => p.status === "streaming");
  const live = judging ? " is-live" : "";
  const stageRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={stageRef} className={`${styles.stage} comic-halftone${live}`}>
      {/* radial action lines emanating from stage center while judging */}
      <div className={`comic-speedlines stage-motion${live}`} aria-hidden />
      <div className={`${styles.spotlight} stage-motion`} aria-hidden />

      {extracting && (
        <div className={styles.banner}>正在从课堂笔记抽取要点清单…</div>
      )}

      <div className={styles.row}>
        {performers.length === 0 ? (
          <div className={styles.empty}>
            配置好评审 Agent 并填入题目/笔记/答案，点击「开始评分」，评审团就会登台。
          </div>
        ) : (
          performers.map((p) => {
            const revealed = p.status === "done" && typeof p.score === "number";
            return (
              <div key={p.id} className={styles.slot}>
                <div className={styles.eqSlot}>
                  <Equalizer accentIndex={p.accentIndex} active={p.status === "streaming"} />
                </div>
                <SpriteCharacter
                  name={p.name}
                  accentIndex={p.accentIndex}
                  status={p.status}
                  score={p.score}
                  dim={p.status === "pending"}
                />
                {revealed && (
                  <div className={styles.scoreWrap}>
                    <div
                      className="comic-pow is-reveal stage-motion"
                      style={{ ["--accent" as string]: `var(--agent-${p.accentIndex})` }}
                      aria-hidden
                    >
                      <span>{(p.score as number) >= 60 ? "POW!" : "OOF!"}</span>
                    </div>
                    <div
                      className={`${styles.scoreTag} stage-motion`}
                      style={{
                        ["--tag" as string]:
                          (p.score as number) >= 85
                            ? "var(--color-success)"
                            : (p.score as number) >= 60
                              ? "var(--color-primary)"
                              : "var(--color-secondary)",
                      }}
                    >
                      {p.score}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* One shared WebGL context blanketing the stage. Robots are drawn as a
          low z-index background; the HTML slots (names / equalizers / score
          badges) float above via their z-index:2. Rendered last so it wins over
          the halftone/speedline layers but still sits under the slot content. */}
      {performers.length > 0 && (
        <StageCanvas
          performers={performers.map((p) => ({
            id: p.id,
            accentIndex: p.accentIndex,
            status: p.status,
            score: p.score,
          }))}
        />
      )}
    </div>
  );
}
