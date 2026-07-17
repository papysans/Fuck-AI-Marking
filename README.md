# 评分录音棚 · AI Grading Beatbox

多 Agent 评审团 Web 应用：输入**题目 + 课堂笔记 + 你的答案**，动态调用多个不同厂商的大模型（DeepSeek / 豆包 / OpenAI…）作为独立评审，**并发流式**按"课堂笔记要点覆盖度"给答案打分并列出漏点；最后由一个"制作人"Agent 归并出按优先级排序的补漏清单。你据此改答案、二次回传，评审带上下文继续评。

> 目标：用多模型评审团逼近未知的 AI 判卷器，把"任何合理评分标准下都会失分"的客观缺陷压出来 → 修掉即让答案对任意 AI 判卷更鲁棒。

## 技术栈

Next.js 15 (App Router) · React 19 · TypeScript(strict) · CSS Modules + 设计令牌 · GSAP · Zod。前端为 Incredibox 风"评分录音棚"（角色随节拍演出 + 下层 Bento 可读卡片 + 专注模式）。

## 评分内核（三段式）

1. **Stage A 抽要点**：从课堂笔记 + 题目抽出原子要点清单 `[{id, text, weight}]`（共享给所有评审，可编辑）。
2. **Stage B 逐点判定**：每个评审 Agent 对每个要点判 `covered / partial / missing`，且**先逐字引用答案证据再下判定**（引不出 → 强制 missing，反幻觉）。
3. **Stage C 算分**：前端按 `权重 × (1/0.5/0)` 公式**确定性算出 0-100 分**——分数由代码算，不由模型拍。

聚合：`union-of-missing`（任一评审判缺失即列入补漏清单）+ 分歧标记。

## 运行

```bash
npm install
npm run dev      # http://localhost:3000
```

打开页面后：

1. 在「评审团配置」里为每个评审填 **baseURL / API Key / model**（Key 只存在你浏览器的 localStorage，经 `/api/proxy` 透明代理转发，不落服务器）。
   - DeepSeek：`https://api.deepseek.com` · `deepseek-chat`
   - 豆包(火山方舟)：`https://ark.cn-beijing.volces.com/api/v3` · 填你的接入点 Endpoint ID
   - OpenAI：`https://api.openai.com/v1` · `gpt-4o-mini`
2. 填题目、课堂笔记、你的答案，点「开始评分」。
3. 看评审团流式打分 → 读制作人补漏清单 → 改答案 → 点「带上下文重新评分」。

## 安全

- API Key 仅存浏览器 localStorage，每次请求随体发送到本地 `/api/proxy`，仅用于构造上游 Authorization 头，**不记录、不持久化、不回显**。
- 本地开发可选：把 Key 放 `.env.local`（已 gitignore）。切勿提交真实 Key。

## 角色美术（可换肤）

当前角色是程序化 SVG 占位。`<SpriteCharacter>` 已支持传入精灵图配置 `{ sheetUrl, frameCount, fps, ... }`，未来可换成 AI 生成的同风格角色队或 CC0 精灵包，动画系统不变。人物用 `steps()` 低帧定格、背景 60fps 顺滑，形成漫画电影质感。
