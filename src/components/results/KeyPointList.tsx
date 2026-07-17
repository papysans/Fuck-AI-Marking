"use client";

import { useState } from "react";
import type { CoverageLabel, KeyPoint } from "@/lib/types";
import styles from "./KeyPointList.module.css";

const TONE_CLASS: Record<CoverageLabel, string> = {
  missing: styles.missing,
  partial: styles.partial,
  covered: styles.covered,
};

const TONE_EVIDENCE_CLASS: Record<CoverageLabel, string> = {
  missing: styles.evMissing,
  partial: styles.evPartial,
  covered: styles.evCovered,
};

/** Per-key-point judging detail, keyed by key-point id in `details`. */
export interface KeyPointDetail {
  evidence: string;
  reasoning: string;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M4 2.5 8 6l-4 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KeyPointList({
  title,
  items,
  tone,
  details,
  showWeight = true,
  collapsible = false,
}: {
  title: string;
  items: KeyPoint[];
  tone: CoverageLabel;
  /** optional per-id judging detail; when present, rows become expandable */
  details?: Record<string, KeyPointDetail>;
  /** hide the "权重 N" tag (e.g. for the covered group which lacks real weights) */
  showWeight?: boolean;
  /** render the whole section as a collapsible block, collapsed by default */
  collapsible?: boolean;
}) {
  const [sectionOpen, setSectionOpen] = useState(!collapsible);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const heading = collapsible ? (
    <button
      type="button"
      className={styles.sectionToggle}
      aria-expanded={sectionOpen}
      onClick={() => setSectionOpen((v) => !v)}
    >
      <Chevron open={sectionOpen} />
      <span className={styles.title}>{title}</span>
      <span className={styles.count}>{items.length}</span>
    </button>
  ) : (
    <h4 className={styles.title}>{title}</h4>
  );

  const bodyVisible = !collapsible || sectionOpen;

  return (
    <div className={styles.wrap}>
      {heading}
      {bodyVisible &&
        (items.length === 0 ? (
          <p className={styles.empty}>无</p>
        ) : (
          <ul className={styles.list}>
            {items.map((kp) => {
              const detail = details?.[kp.id];
              const isOpen = expanded.has(kp.id);
              const rowInner = (
                <>
                  <span
                    className={`${styles.dot} ${TONE_CLASS[tone]}`}
                    aria-hidden="true"
                  />
                  <span className={styles.text}>{kp.text}</span>
                  {showWeight && (
                    <span className={styles.weight}>权重 {kp.weight}</span>
                  )}
                  {detail && (
                    <span className={styles.rowChevron}>
                      <Chevron open={isOpen} />
                    </span>
                  )}
                </>
              );

              return (
                <li key={kp.id} className={styles.item}>
                  {detail ? (
                    <>
                      <button
                        type="button"
                        className={styles.row}
                        aria-expanded={isOpen}
                        onClick={() => toggle(kp.id)}
                      >
                        {rowInner}
                      </button>
                      {isOpen && (
                        <div className={styles.detail}>
                          {detail.reasoning &&
                            detail.reasoning !== kp.text && (
                              <p className={styles.reasoning}>
                                <span className={styles.detailLabel}>评审理由</span>
                                {detail.reasoning}
                              </p>
                            )}
                          {detail.evidence ? (
                            <blockquote
                              className={`${styles.evidence} ${TONE_EVIDENCE_CLASS[tone]}`}
                            >
                              {detail.evidence}
                            </blockquote>
                          ) : (
                            <p className={styles.noEvidence}>
                              未在答案中找到对应内容
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={styles.rowStatic}>{rowInner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
