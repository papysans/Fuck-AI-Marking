import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "圆桌议会 · Round Table Council",
  description: "多 Agent 评审团 · 流式给课后习题答案打分并压出漏点",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
