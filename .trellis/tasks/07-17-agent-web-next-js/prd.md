# 多Agent答案评分Web（Next.js流式评审团）

## Goal

构建一个本地 Web 应用：用户输入 **题目 + 课堂笔记 + 自己的答案**，系统**动态调用多个不同厂商的大模型（OpenAI / DeepSeek / 豆包等）作为独立评审 Agent**，各自**流式**地按"课堂笔记要点覆盖度"给答案打分并指出漏点；最后由一个**汇总 Agent** 归并所有评审的问题清单。用户据此**修改答案并二次回传**，各 Agent**带上下文继续评分**。

真正目标（核心洞察）：拿不到老师那台判卷 AI 的模型/prompt/rubric，所以本系统本质是**用多模型评审团逼近未知判卷器的评分分布**，把"在任何合理评分标准下都会失分"的客观缺陷压出来 → 修掉它们 = 答案对任意 AI 判卷**鲁棒**，而非针对性"钻空子"。

## What I already know

* 输入三要素：题目、课堂笔记、我的答案。
* 评分内核由用户定调：**主要看答案是否答到课堂笔记里的所有要点**（key-point coverage）。
* 需适配 OpenAI / DeepSeek / 豆包等主流模型，通过 OpenAI 兼容协议统一接入。
* 多个 Agent 并发运行，要求**流式**输出。
* 前端可**动态增删/配置** Agent。
* 一个汇总 Agent 总结所有问题。
* 支持**多轮**：二次回传修改后的答案，Agent 利用上下文继续评。

## Decisions (locked)

| 决策项 | 结论 |
|---|---|
| 技术栈 | **Next.js 全栈**（App Router），前端 + API route 一体 |
| API Key 存放 | **仅存浏览器 `localStorage`**，每次请求带 Key 打到 Next.js API route |
| API route 角色 | **透明代理**：接收前端的 {baseURL, key, model, messages} → 转发到各厂商 OpenAI 兼容 endpoint → **SSE 流回传** |
| 为何要 route 而非浏览器直连 | 绕过豆包/国内厂商的 **CORS 拦截** + 保证流式不被掐；Key 仍不落服务器存储 |
| 模型接入方式 | 统一 **OpenAI 兼容 `chat/completions` + `stream:true`**；每个 Agent = {name, baseURL, apiKey, model, 角色prompt} |
| 评分内核 | 从**课堂笔记**抽要点清单 → 逐点判定 **覆盖/部分/缺失 + 准确性** → 聚合打分 + 列出漏点 |

## Requirements (evolving)

* R1 前端可配置一个 Agent 列表（增删改），每项含 name / baseURL / apiKey / model / 可选角色prompt；持久化到 localStorage。
* R2 提供三个输入区：题目、课堂笔记、我的答案。
* R3 点击评分 → 所有启用的评审 Agent **并发** 调用，各自**独立流式**渲染（每个 Agent 一个卡片/列，实时打字机效果）。
* R4 每个评审 Agent 产出**结构化结果**：分数 + 命中要点 + 缺失/部分要点 + 简评。
* R5 全部评审完成后，汇总 Agent 读取所有评审输出 → **流式**产出归并后的问题清单（多模型共同指出的漏点优先）。
* R6 多轮：用户改答案后再次提交，各 Agent **带上一轮对话上下文**继续评分（对比上一轮，指出是否已修复）。
* R7 API route 透明代理 SSE，支持任意 OpenAI 兼容 endpoint。

## Resolved Decisions (from Q&A + research)

* Q1 输入粒度 → **一次一道题**（题目 + 相关笔记 + 答案）；多题就开多个会话/标签页。
* Q2 打分刻度 → **0-100 分 + 要点清单**；但分数**由代码从逐点判定确定性算出**，非模型直接拍（见 Technical Approach）。
* Q3 默认 Agent → **预置三家模板**（DeepSeek / 豆包 / OpenAI，空 Key 待填）。
* Q4 结构化输出 → **流式自然语言点评 + 末尾 JSON 块**；JSON 块装逐要点判定，前端据此算分。

## Technical Approach

**评分三段式（研究驱动，核心：分数由代码算不由模型拍）**

* **Stage A — 要点抽取（共享，每题一次）**：一次调用把「题目 + 课堂笔记」→ 原子要点清单 `[{id, text, weight}]`。清单展示在页面且**用户可编辑**。所有评审 Agent 共用同一份清单（apples-to-apples）。
* **Stage B — 逐点判定（每个评审 Agent 各一路，并发流式）**：给定共享要点清单 + 答案，对**每个**要点输出：先 `student_evidence`（逐字引用答案证据）→ `reasoning`（1-2 句）→ `label ∈ {covered, partial, missing}`。引不出证据 → 强制 `missing`。判定 = 温度 0。前端流式渲染自然语言点评，末尾 JSON 块承载 `results[]`。
* **Stage C — 算分（前端确定性代码）**：校验 JSON（id 集合完全一致、label 合法、evidence 是答案子串，否则降级 missing）→ `score = round(100 * Σ weight·f(label) / Σ weight)`，f(covered/partial/missing)=1/0.5/0。
* **聚合**：逐要点跨模型对比；反馈用 **union-of-missing**（任一模型判漏即列入补漏清单）；模型分歧的要点标记 `uncertain` 提示重点关注。
* **汇总 Agent**：读取全部评审的判定 → 流式产出**按优先级排序的补漏/修改清单**（多模型共同指出的漏点排最前）。
* **多轮**：改答案后二次提交，各 Agent 带上一轮 messages 上下文，对同一份要点清单重判，并指出「上一轮的漏点是否已修复」。

**反偏差要点（烤进 prompt）**：显式声明"长度/流畅度/语气无关，只判要点是否事实性命中"；证据先于判定；只判这 N 个 id、不增不减。

## Frontend Design — Incredibox "Grading Studio"（炫技方向）

设计系统存于 `design-system/ai-grading-beatbox/MASTER.md`（palette 已 override 为幽暗舞台风）。核心：把"多 Agent 并发流式"演成一场 Incredibox 式舞台，**上层演出 + 下层可读 + 专注模式逃生舱**。

* **舞台层（spectacle）**：每个评审 Agent = 一个角色 avatar，一排站开，各持一种"声部色"（`--agent-1..6`）。空闲静止暗淡；**流式评分时随节拍上下晃动 + 头顶均衡器声波脉动**，吐出的 token 滚入其气泡（token 即"歌声"）。多 Agent 并发 = 多角色同台演出。评完：**分数徽章 GSAP Flip 翻转弹出**，角色按分数摆胜/败 pose。汇总 Agent = 居中"制作人"，把各角色判定混音成优先级补漏清单。
* **结果层（substance）**：每 Agent 一张 Bento 卡 = 分数 + 命中/漏点 + 证据引用；静态可读、对比度达标。
* **专注模式 / reduced-motion 开关**：一键停晃动纯读评语，兼顾无障碍（`prefers-reduced-motion` 必须尊重）。
* **视觉**：字体 Fredoka(标题)/Nunito(正文)；深靛蓝舞台 `#12131C` + 琥珀聚光 `#FFC24B` + 奶油文字 `#F5F1E6`；Bento 卡片布局。
* **动效栈**：GSAP + ScrollTrigger（角色进场 `back.out` 弹跳 stagger、声波循环、分数 Flip `expo.inOut`）。声波/晃动用 transform-only，避免 layout thrash。
* **取舍**：Incredibox 纯娱乐，本项目是工具 → 演出不得牺牲"读漏点清单"的效率；移动端降级为静态卡片（舞台层可折叠）。

### 角色动画：漫画定格风（低帧人物 + 高帧背景）

* **机制**：人物用**精灵图 + CSS `steps(n)`** 逐帧硬切（8–12fps 定格漫画感）；背景用 GSAP 60fps 视差/渐变/粒子。两套独立时钟，对比产生"手绘角色贴动态世界"的电影感。人物动画 = 刻意低帧，非性能问题。
* **关键架构：动画系统与美术素材解耦**。做通用 `<SpriteCharacter>` 组件，吃配置 `{ sheetUrl, frameCount, fps, cols, states: {idle, singing, win, lose} }`；素材是可替换资产层，不是前置阻塞项。
* **素材策略（分阶段）**：MVP 用**程序化 SVG 占位角色**（已带 steps 跳帧节奏）跑通演出+联调流式；后续增量替换为 ①AI 生成的同风格角色队（推荐，风格统一版权干净）或 ②CC0 精灵包（Kenney / itch.io CC0 / RGS_Dev 模块化矢量角色）。**禁止**直接扒非授权网图（版权风险 + 画风不统一）。
* **状态映射**：idle（静止/轻晃）→ singing（评分流式中，随节拍跳帧 + 头顶均衡器）→ win/lose（分数揭晓 pose，按分数阈值）。

## 反 gaming 立场（与用户目标对齐）

本工具通过"多模型共同挑出的客观缺陷"逼近未知判卷器 → 修掉即鲁棒。**不做**针对特定判卷 AI 的提示词注入/关键词堆砌（脆弱、换判卷器即失效），见 Out of Scope。

## Acceptance Criteria (evolving)

* [x] 能配置 ≥2 个不同厂商模型并同时评分，各自流式输出互不阻塞。（并发架构已实现；已用 DeepSeek 单家真实验证流式，多家需用户各自填 Key 验证）
* [x] 每个评审 Agent 输出包含分数 + 明确的"缺失要点"清单。（Stage B/C 真实验证：命中3漏3、分数58）
* [x] 汇总 Agent 能归并多个评审的问题并去重。（union-of-missing + 分歧标记已实现）
* [x] 改答案二次提交后，Agent 输出能体现"对比上一轮"的增量判断。（revise() 带上下文重判已实现）
* [x] API Key 不出现在任何服务器端持久化存储/日志中。（代理仅用于构造上游 header，不记录/持久化/回显）
* [x] 豆包/DeepSeek 通过 route 代理可成功流式（验证 CORS 不再是问题）。（DeepSeek 真实 SSE 流回验证通过）

**验证状态**：`tsc --noEmit` ✓ · `next build` ✓（lint 通过、4 页面生成）· 流式代理 + Stage A/B/C 用真实 DeepSeek Key 端到端跑通。**尚未做**：浏览器内可视化交互验证（舞台演出/卡片渲染的肉眼确认）——需人工或浏览器自动化点一遍。

## Definition of Done

* Lint / typecheck 通过，`next build` 成功。
* 三家（至少 DeepSeek + 豆包 + 一个 OpenAI 兼容）真实跑通流式评分。
* README 说明如何填各厂商 baseURL/model。

## Out of Scope (explicit)

* 用户账号系统 / 服务端密钥托管 / 数据库持久化历史（本期只用 localStorage）。
* 真正针对某台特定判卷 AI 的提示词注入 / 关键词堆砌类"gaming"（脆弱且非目标）。
* 多语言 / 移动端专门适配（先桌面浏览器可用即可）。
* 自动扒取老师真实 rubric（拿不到）。

## Technical Notes

* 各厂商 OpenAI 兼容 endpoint（待实现时在 route 层验证）：
  * DeepSeek: `https://api.deepseek.com` (`deepseek-chat` / `deepseek-reasoner`)
  * 豆包/火山方舟 Ark: `https://ark.cn-beijing.volces.com/api/v3`（model 用 endpoint id）
  * OpenAI: `https://api.openai.com/v1`
* 流式：route 用 Web Streams / `ReadableStream` 直接 pipe 上游 SSE；前端用 `fetch` + `getReader()` 逐块解析 `data:`。
* 并发：前端为每个 Agent 各发一路 fetch，互相独立；汇总 Agent 在 `Promise.allSettled` 全部评审结束后触发。

## Research References

* [`research/llm-grader-best-practices.md`](research/llm-grader-best-practices.md) — LLM-as-judge 打分 prompt 设计 / 偏差规避 / note-coverage 聚合（调研中）
