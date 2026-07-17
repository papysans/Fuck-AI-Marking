"use client";

import type { CoverageLabel, KeyPoint } from "@/lib/types";
import styles from "./KeyPointList.module.css";

const TONE_CLASS: Record<CoverageLabel, string> = {
  missing: styles.missing,
  partial: styles.partial,
  covered: styles.covered,
};

export function KeyPointList({
  title,
  items,
  tone,
}: {
  title: string;
  items: KeyPoint[];
  tone: CoverageLabel;
}) {
  return (
    <div className={styles.wrap}>
      <h4 className={styles.title}>{title}</h4>
      {items.length === 0 ? (
        <p className={styles.empty}>无</p>
      ) : (
        <ul className={styles.list}>
          {items.map((kp) => (
            <li key={kp.id} className={styles.item}>
              <span className={`${styles.dot} ${TONE_CLASS[tone]}`} aria-hidden="true" />
              <span className={styles.text}>{kp.text}</span>
              <span className={styles.weight}>权重 {kp.weight}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
