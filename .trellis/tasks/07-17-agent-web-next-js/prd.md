# 圆桌议会 · 多Agent答案评分Web（Next.js流式评审团）

> **本文档描述已实现的系统。** 每条技术陈述都对应代码里的具体文件；尚未实现的东西一律归入
> 「未实现 / 后续计划」，已放弃的方案一律归入「已废弃的方向（历史）」。改代码时请同步改这里。

## Goal

本地 Web 应用：用户输入 **题目 + 课堂笔记 + 自己的答案**，系统调用多个不同厂商的大模型
（DeepSeek / 豆包 / OpenAI 等）作为独立评审 Agent，各自**并发流式**地按"课堂笔记要点覆盖度"
给答案打分并指出漏点；再由一个"议长"角色归并所有评审的问题，产出按优先级排序的补漏清单。
用户据此**修改答案并二次提交**，各 Agent**带上一轮上下文继续评分**。

真正目标（核心洞察）：拿不到老师那台判卷 AI 的模型/prompt/rubric，所以本系统本质是
**用多模型评审团逼近未知判卷器的评分分布**，把"在任何合理评分标准下都会失分"的客观缺陷压出来
→ 修掉它们 = 答案对任意 AI 判卷**鲁棒**，而非针对性"钻空子"。

## Decisions (locked)

| 决策项 | 结论 |
|---|---|
| 技术栈 | **Next.js 15 App Router**（前端 + API route 一体）· React 19 · TypeScript strict · CSS Modules · Zod |
| API Key 存放 | **仅存浏览器 `localStorage`**，每次请求带 Key 打到 Next.js API route |
| API route 角色 | **透明代理**（`src/app/api/proxy/route.ts`）：收 {baseUrl, apiKey, model, messages} → 转发到上游 OpenAI 兼容 endpoint → **SSE 流原样 pipe 回传** |
| 为何要 route 而非浏览器直连 | 绕过豆包/国内厂商的 **CORS 拦截** + 保证流式不被掐；Key 仍不落服务器存储 |
| 模型接入方式 | 统一 **OpenAI 兼容 `/chat/completions` + `stream:true`**；每个 Agent = `{id, name, baseUrl, apiKey, model, accentIndex, enabled, roleHint?}`（`src/lib/types.ts`） |
| 评分内核 | 从课堂笔记抽要点清单 → 逐点判定 覆盖/部分/缺失 → **代码确定性算分** + 列出漏点 |
| 抽取器 / 议长的身份 | **不是单独配置的 Agent**：Stage A 抽取和最后的合议裁定都复用**第一个启用的评审**（`useStreamingGrade.ts` 里的 `enabled[0]`） |

## Requirements（已实现）

* R1 `/settings` 可增删改评审列表，每项含 name / baseUrl / apiKey / model / 可选 roleHint；持久化到 localStorage。（`src/app/settings/page.tsx`、`src/components/config/AgentConfigPanel.tsx`、`src/lib/storage.ts`）
* R2 三个输入区：题目、课堂笔记、我的答案。（`src/components/inputs/ProblemInputs.tsx`）
* R3 点击评分 → 所有启用的评审**并发**调用（`Promise.all`，每路失败自行兜底不阻断其它路），各自**独立流式**渲染。（`src/hooks/useStreamingGrade.ts`）
* R4 每个评审产出结构化结果：分数 + 命中/缺失/不完整要点 + 逐要点证据 + 简评。（`src/lib/grading.ts`、`src/components/results/AgentCard.tsx`）
* R5 全部评审结束后，议长读取各评审的判定 → **流式**产出归并后的优先级修改清单。（`runSummary`、`src/lib/prompts.ts` 的 `SUMMARY_SYSTEM`）
* R6 多轮：改答案后再次提交，各 Agent **带上一轮 messages 上下文**重判并对比上一轮。（`revise()`、`buildRejudgeMessage`）
* R7 API route 透明代理 SSE，支持任意 OpenAI 兼容 endpoint。

## Resolved Decisions

* Q1 输入粒度 → **一次一道题**；多题开多个标签页（历史记录按题去重）。
* Q2 打分刻度 → **0-100 分 + 要点清单**；分数由代码从逐点判定确定性算出，非模型直接拍。
* Q3 默认 Agent → **预置三家模板**（DeepSeek / 豆包 / OpenAI，空 Key 待填）。（`src/lib/providers.ts`）
* Q4 结构化输出 → **流式自然语言点评 + 末尾 `<JUDGE_JSON>` 块**；JSON 块装逐要点判定，前端据此算分。

## Technical Approach（实际实现）

**评分三段式 —— 核心：分数由代码算，不由模型拍**（`src/lib/prompts.ts` + `src/lib/grading.ts`）

* **Stage A — 要点抽取（每题一次，温度 0）**：一次调用把「题目 + 课堂笔记」→ 原子要点清单
  `[{id, text, weight}]`（weight 1-5，Zod `KeyPointsSchema` 校验）。所有评审共用同一份清单
  （apples-to-apples）。清单存在 `state.keyPoints` / `keyPointsRef`，但**当前不在任何界面上展示，也不可编辑**
  （见「未实现」）。抽取失败 → `phase: "error"`，整轮中止。
* **Stage B — 逐点判定（每评审一路，并发流式，温度 0）**：给定共享清单 + 答案，对每个要点输出
  `student_evidence`（逐字引用）→ `reasoning`（1-2 句）→ `label ∈ {covered, partial, missing}`。
  前端流式渲染 `<JUDGE_JSON>` 之前的自然语言点评，JSON 块承载 `results[]`。
  可选 `roleHint` 追加进该评审的 system prompt（同厂商多实例靠它区分，否则温度 0 下输出几乎一致）。
* **Stage C — 校验 + 算分（客户端确定性代码，`grading.ts`）**：
  * 模型未判定的 id → **补为 `missing`**（reasoning 注明）。
  * 非 `missing` 判定的 evidence 必须能在答案里**逐字命中**（比对时忽略空白）；引不出 → **降级为 `partial`**（不是 missing），并在 reasoning 追加降级说明。
  * `<JUDGE_JSON>` 缺失 / JSON 解析失败 / Zod 不过 → 该评审标记 `invalid`，**不计入聚合**。
  * `score = round(100 * Σ weight·f(label) / Σ weight)`，f(covered/partial/missing)=1/0.5/0。
* **聚合（`aggregate()`）**：只统计有效（非 invalid）评审 → **中位分** `medianScore`；
  **union-of-missing**（任一评审判 missing 即列入补漏清单）；**分歧标记** `disagreements`
  （有评审判 covered、有评审判非 covered）。
* **议长 / 合议裁定**：复用 `enabled[0]`（温度 0.2），读取各评审的 score + missing + partial 列表 →
  流式产出按优先级排序的中文修改清单（越多评审共同判漏的越靠前，分歧要点显式标注）。
* **多轮**：`revise()` 给每个评审追加一条 user 消息（含修改后答案），带上一轮完整 messages 上下文，
  对**同一份要点清单**重判，并要求点评里明确指出上轮 partial/missing 是否补上。

**反偏差要点（烤进 prompt）**：显式声明"长度/流畅度/语气无关，只判要点是否事实性命中"；
证据先于判定；只判这 N 个 id、不增不减；提及但错误 → 绝不是 covered。

## Frontend（实际实现）

主题为**圆桌议会**：汇总 Agent = **议长**，其产出 = **合议裁定**。
设计令牌见 `design-system/round-table-council/MASTER.md`（深靛蓝 `#12131C` + 琥珀 `#FFC24B` +
奶油 `#F5F1E6`；Fredoka 标题 / Nunito 正文）。

### 两种模式

顶部一键切换，选择持久化到 localStorage `agb.mode.v1`（`src/app/page.tsx`；旧值 `fancy` 迁移为
`immersive`；hydration 前渲染中性占位，避免默认值覆盖已存选择）。

* **简洁（默认，零 WebGL）**：状态条（`status/AgentStatusBar`）+ 输入卡 + 每评审一张结果卡
  （`results/AgentCard`，含分数、命中/不完整/缺失分组、逐要点展开看证据与理由）+ 合议裁定面板
  （`results/SummaryPanel`）。功能完整。
* **沉浸（全页 Three.js）**：`immersive/ImmersiveShell` + `scene/*`。

### 沉浸模式的实现事实（`src/components/scene/`）

* **单个全屏 r3f `<Canvas>`**（`SceneCanvas.tsx`），**不是 `<View>`**（在本仓库实测为空白）；
  由 `ImmersiveScene.tsx` 经 `next/dynamic({ ssr: false })` 客户端加载。
* **角色 = KayKit CC0 模型**（Knight / Mage / Barbarian / Skeleton_Warrior，`public/models/*.glb`）。
  N 个评审 = N 个角色**围成圆圈朝圆心"争论"**；角色按 `seedOf(id)` 稳定分配（不用数组下标，避免删人后重掷）。
  身高按**身体**归一（`MEASURE_BASIS = "body"`，排除法师的大帽子）、脚落地；重复武器按 `handslot*` 骨骼隐藏。
* **相机**：`OrbitControls makeDefault` 是**唯一旋转源**（禁 pan/zoom）+ autoRotate（50s 一圈，交互/运镜时暂停，
  静置 3.5s 恢复）+ damping 惯性；`CameraRig` 负责开场姿态与聚焦飞行。
* **光照/后期**：程序化 `<Environment>` + `<Lightformer>`（**无外链 HDRI**，避开 drei preset 拉资源的 CSP 坑）
  + `<ContactShadows>` + 可关的 Bloom/Vignette。`prefers-reduced-motion` 下自动关动效与 Bloom。
* **气泡**：角色头顶 `<Html>` 对话框显示实时流式点评。
* **聚焦单人**：相机飞到脸部（`FOCUS_DIST = 7`），横向 truck 让角色落到视口 ~65%（`FOCUS_SHIFT_NDC = 0.3`），
  面板左锚定，**该角色气泡隐藏**、其余角色淡出。

### 阶段叙事 IA（`ImmersiveShell.tsx` 顶部的"空间契约"）

**铁律：一幕一焦点；同一段文字绝不同时出现在两处。**

| phase | 3D 舞台 | 气泡 | UI 面板 |
|---|---|---|---|
| `idle` | 圆圈待命 | 隐藏 | 输入卡（左） |
| `extracting` | 圆圈待命 | 隐藏 | 左：折叠输入卡 + 一行提示 |
| `judging` | 争论 | **显示** | 仅底部芯片轨 —— **无面板** |
| `summarizing` / `done` | 全景 | 隐藏 | **合议裁定居中、默认展开**，芯片在其下可下钻 |
| 聚焦某评审 | 单人特写 | 隐藏 | 聚焦面板左锚定，芯片在其下 |

另有「查看完整结果」弹窗（`ResultModal`）承载完整卡片 + 合议裁定 + 导出。

### 动画状态机（`scene/characters.ts`，按各模型**实际** clip 列表降级解析）

* pending → `Idle` / `Unarmed_Idle`
* streaming → 循环 `Spellcasting` / `Spellcast_Raise` / `Interact` / `Throw` / `Unarmed_Melee_Attack_Punch_A|B` / `Block_Attack`（`Taunt` / `Taunt_Longer` **仅骷髅有**）
* done → 分数 **≥60 `Cheer`**（备选 `Jump_Full_Short`）/ **<60 `Death_A`**（备选 `Death_B`）
* error → `Hit_A` / `Hit_B`；聚焦时一次性手势 → `Taunt` / `Spellcast_Raise` / `Interact` / `Cheer`
* 过滤静态单帧假 clip：`T-Pose` 与所有 `*_Pose`

### 其它功能

* **导出报告**（`src/lib/report.ts`）：复制到剪贴板 + 下载 `.md`，含题目/笔记/答案、各评审打分与点评、合议裁定、补漏清单、分歧要点。
* **历史记录**（`src/lib/history.ts`、`components/history/HistoryDrawer.tsx`）：完成一轮自动存快照，localStorage **上限 30 条**；同题多轮合并为一条（最新轮覆盖）；可只读回看（不重调模型）、删除、清空。
* **`/demo`**：用写死假数据 + 模拟流式驱动**同一个** `<ImmersiveScene>`，不调任何模型，作开发基线。

## 反 gaming 立场（与用户目标对齐）

本工具通过"多模型共同挑出的客观缺陷"逼近未知判卷器 → 修掉即鲁棒。**不做**针对特定判卷 AI 的
提示词注入/关键词堆砌（脆弱、换判卷器即失效），见 Out of Scope。

## 未实现 / 后续计划

* **要点清单的展示与编辑**（原设计的核心一环，至今是待办）：Stage A 抽出的清单目前只存在内存里
  （`state.keyPoints`），**界面上既不展示也不可编辑**。用户无法在判定前修正抽错/漏抽的要点，
  也无法调 weight —— 而清单质量直接决定所有评审的分数。属最高优先级欠账。
* **豆包 / OpenAI 的真机流式验证**：架构上走同一套 OpenAI 兼容客户端，但只有 DeepSeek 被真实 Key 跑通过。
* **"正确但不在笔记里"的加分/送审路径**（research 里建议过，未做）：当前覆盖度打分会误伤笔记没预料到的正确答案。
* **gold set 校准 / 模型可靠度加权**（research §2.5、§4.2）：未做。
* **移动端**：未适配（见 Out of Scope）。

## 已废弃的方向（历史，非现状）

* **Incredibox "Grading Studio" 2D 精灵图路线**（首版设计，已整体放弃）：曾计划用精灵图 +
  CSS `steps(n)` 做 8–12fps 定格漫画角色、GSAP 声波均衡器 + 分数徽章 Flip、通用 `<SpriteCharacter>` 组件、
  "上层演出 + 下层 Bento 卡"、程序化 SVG 占位角色再换 CC0 精灵包。
  **放弃原因**：程序化 2D 占位角色实际观感不佳，且"低帧人物 + 高帧背景"的对比在工具类界面里
  没有说服力 → 改为直接上 3D（KayKit CC0 + Three.js），演出与素材的解耦目标由 `scene/characters.ts`
  的数据驱动配置达成。**相关代码（`src/components/stage/`、`<SpriteCharacter>`）已全部删除，勿再引用。**
* **"评分录音棚"主题**：已改为**圆桌议会**（议长 / 合议裁定）。
* **`RobotExpressive.glb`**：仍在 `public/models/`，但**当前无任何代码加载**，仅作兜底保留。

## Acceptance Criteria

* [x] 能配置 ≥2 个不同厂商模型并同时评分，各自流式输出互不阻塞。（并发架构已实现并有头浏览器验证；**多厂商同跑需用户各自填 Key**，仅 DeepSeek 经真实验证）
* [x] 每个评审输出包含分数 + 明确的"缺失要点"清单。（Stage B/C 真实验证）
* [x] 议长能归并多个评审的问题并去重。（union-of-missing + 分歧标记）
* [x] 改答案二次提交后，输出体现"对比上一轮"的增量判断。（`revise()` 带上下文重判）
* [x] API Key 不出现在任何服务器端持久化存储/日志中。（代理仅用于构造上游 header，不记录/持久化/回显）
* [x] 国内厂商通过 route 代理可成功流式（CORS 不再是问题）。（DeepSeek 真实 SSE 流回验证通过；豆包同路径未实测）

**验证状态**

* 已验证（真实 DeepSeek Key + 有头浏览器点过）：评分三段式（Stage A/B/C）、流式代理、
  简洁/沉浸双模式、沉浸五幕叙事（idle→extracting→judging→summarizing/done）、聚焦运镜、
  模式切换往返持久化。
* 静态检查：`tsc --noEmit` ✓ · `next build` ✓（lint 通过）。
* **未验证**：豆包 / OpenAI 真机流式（需用户自备 Key）；移动端；多厂商并发同跑。

## Definition of Done

* Lint / typecheck 通过，`next build` 成功。—— ✓
* README 说明如何填各厂商 baseURL/model。—— ✓
* 三家（至少 DeepSeek + 豆包 + 一个 OpenAI 兼容）真实跑通流式评分。—— **未完成**（仅 DeepSeek）

## Out of Scope (explicit)

* 用户账号系统 / 服务端密钥托管 / 数据库持久化历史（本期只用 localStorage）。
* 针对某台特定判卷 AI 的提示词注入 / 关键词堆砌类"gaming"（脆弱且非目标）。
* 多语言 / 移动端专门适配（先桌面浏览器可用即可）。
* 自动扒取老师真实 rubric（拿不到）。

## Technical Notes

* 各厂商 OpenAI 兼容 endpoint（`src/lib/providers.ts` 预置）：
  * DeepSeek: `https://api.deepseek.com` (`deepseek-chat` / `deepseek-reasoner`)
  * 豆包/火山方舟 Ark: `https://ark.cn-beijing.volces.com/api/v3`（model 填**接入点 Endpoint ID** `ep-...`，不是模型名）
  * OpenAI: `https://api.openai.com/v1`
* 流式：route 直接把上游 `Response.body` 作为响应体 pipe 回来（`no-transform`）；
  前端 `fetch` + `getReader()` 按 SSE 帧（空行分隔）解析 `data:`，取 `choices[0].delta.content`（兼容 `.text`）。（`src/lib/openaiStream.ts`）
* 并发：前端为每个 Agent 各发一路 `/api/proxy` fetch；`judgeOne` 内部自己 catch，故用 `Promise.all` 即可
  等齐全部评审（失败的返回 `null`，不 reject），随后触发议长。
* 服务端**不读取任何环境变量密钥**；`.env.local.example` 里的条目是预留占位。

## Research References

* [`research/llm-grader-best-practices.md`](research/llm-grader-best-practices.md) — LLM-as-judge 打分 prompt 设计 / 偏差规避 / note-coverage 聚合。实现已采纳：抽取与判定分离、逐点三元标签、证据先于判定、代码算分、union-of-missing、分歧送审。未采纳见「未实现」。
