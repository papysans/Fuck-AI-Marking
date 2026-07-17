import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "评分录音棚 · AI Grading Beatbox",
  description: "多 Agent 评审团 · 流式给课后习题答案打分并压出漏点",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
