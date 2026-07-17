# 评分录音棚 · AI Grading Beatbox

输入**题目 + 课堂笔记 + 你的答案**，让多个不同厂商的大模型（DeepSeek / 豆包 / OpenAI…）作为独立评审**并发流式**地按"课堂笔记要点覆盖度"打分、列出漏点，最后由一个"制作人" Agent 归并成按优先级排序的补漏清单。你据此改答案、二次提交，评审带上一轮上下文继续评。

## 为什么是"评审团"

拿不到老师那台判卷 AI 的模型、prompt 和 rubric，所以本工具**不猜它**，而是用多模型评审团去**逼近**它：多个立场不同的模型共同挑出的缺陷，大概率是"在任何合理评分标准下都会失分"的客观问题。修掉这些 → 答案对任意 AI 判卷更鲁棒。

这不是教你钻空子。针对特定判卷器的提示词注入、关键词堆砌都是**明确不做**的：换一台判卷器就失效，且与"把答案真正写好"这个目标背道而驰。

## 评分内核（三段式）

分数由**代码**算，不由模型拍——这是可复现、抗刷分的关键。

| 阶段 | 做什么 |
|---|---|
| **Stage A · 抽要点** | 从「题目 + 课堂笔记」抽出原子要点清单 `[{id, text, weight}]`（权重 1-5）。所有评审共用同一份，保证同标准对比 |
| **Stage B · 逐点判定** | 每个评审对每个要点**先逐字引用答案证据、再下判定** `covered / partial / missing`。温度 0，只判事实是否命中，显式忽略长度/流畅度/语气 |
| **Stage C · 确定性算分** | 前端按 `Σ(权重 × f(label)) / Σ权重 × 100` 算出 0-100 分，`f` = 1 / 0.5 / 0 |

**反幻觉校验**（`src/lib/grading.ts`，在算分前跑）：

- 判定的 id 集合必须与要点清单完全一致；模型漏判的要点**强制补为 `missing`**。
- 非 `missing` 的判定必须附带一段能在答案中**逐字命中**的证据（比对时忽略空白字符）。引不出证据的，**降级为 `partial`** 并在理由里标注。
- 输出的 JSON 块解析失败 → 该评审标记为 `invalid`，**不计入**聚合。

**聚合**：中位分（仅取有效评审）+ `union-of-missing`（任一评审判缺失即列入补漏清单，宁可多报）+ 分歧标记（有评审判 covered、有评审判非 covered → 提示重点核实）。

## 两种模式

顶部按钮一键切换，选择存在 localStorage（`agb.mode.v1`）。

- **简洁**（默认）：零 WebGL。状态条 + 每评审一张结果卡 + 制作人总结。功能完整，导出、历史、逐要点证据都在。
- **沉浸**：全页 Three.js。N 个评审 = N 个 3D 角色围圈"争论"，头顶对话框显示**实时流式**点评；评完按分数播动画（≥60 Cheer / <60 Death），点「查看完整结果」看弹窗里的完整卡片。输入区可折叠。尊重 `prefers-reduced-motion`（自动关闭动效与 Bloom）。

## 模型接入

统一走 OpenAI 兼容的 `/chat/completions` + `stream: true`，一套客户端覆盖所有厂商。到 `/settings` 配置。

| 厂商 | baseURL | model 填法 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` 或 `deepseek-reasoner` |
| 豆包（火山方舟） | `https://ark.cn-beijing.volces.com/api/v3` | **接入点 Endpoint ID**（`ep-...`），不是模型名 |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` / `gpt-4o-mini` 等 |

任何 OpenAI 兼容 endpoint 都能用「新评审」手填接入。

**同厂商配多个实例时，务必用「评审视角」（roleHint）区分**——比如一个从严、一个从宽。判定跑在 temperature 0，同模型同 prompt 的输出几乎一样，不加区分的多实例等于白花钱。roleHint 会追加到该评审的 system prompt 里，这才是多实例的正确用法。

## 安全

- API Key **只存浏览器 localStorage**，每次请求随体发到本地 `/api/proxy`。
- 代理仅用它构造上游 `Authorization` 头，然后把上游 SSE 流原样 pipe 回来：**不记录、不持久化、不回显**。走代理是为了绕开国内厂商的 CORS 拦截并保证流式不被掐，Key 不落服务器存储。
- `.env.local` 已 gitignore。注意：**当前代码不读取任何服务端环境变量密钥**，Key 一律来自浏览器（`.env.local.example` 里的条目是预留占位）。
- **切勿提交真实 Key。**

## 运行

```bash
npm install
npm run dev      # http://localhost:3000
```

1. 到 `/settings` 配置评审团（baseURL / API Key / model，可选 roleHint）。配置自动保存。
2. 回主页填题目、课堂笔记、你的答案 → 点「开始评分」。
3. 读制作人补漏清单 → 改答案 → 点「带上下文重新评分」。

## 功能

- **导出报告**：一键复制到剪贴板并下载 `.md`，含题目/笔记/答案、各评审打分与点评、制作人总结、补漏清单、分歧要点。
- **历史记录**：完成一轮自动存快照（localStorage，上限 30 条）。同一题的多轮修订合并为一条（最新轮覆盖），换题另起一条。可回看（只读回放，不重新调模型）、删除、清空。
- **逐要点证据**：点开要点可看命中的答案原文与评审理由。

## `/demo`

沉浸场景的测试台：用写死的假数据和模拟流式驱动**同一个** `<ImmersiveScene>`，不调任何模型。用来单独眼验环形布局、角色数量变化、头顶气泡、Bloom 开关。保留作开发基线。

## 技术栈

Next.js 15（App Router）· React 19 · TypeScript strict · CSS Modules + 设计令牌 · three / @react-three/fiber / drei / postprocessing · Zod。

## 素材与许可

| 素材 | 来源 | 许可 |
|---|---|---|
| `Knight` / `Mage` / `Barbarian` / `Skeleton_Warrior` | **KayKit**（Kay Lousberg）Character Pack: Adventurers / Skeletons | CC0 1.0 — **无需署名**，此处为礼节性致谢 |
| `RobotExpressive.glb` | three.js 官方示例（Tomás Laulhé 制作 / Don McCurdy 修改） | CC0 |
| Fredoka / Nunito | Google Fonts | 见各自仓库 LICENSE |

`RobotExpressive.glb` 仍在 `public/models/`，但**当前未被任何代码加载**（只在 `Character.tsx` 的注释里作为相机取景的历史基准被提及），保留作兜底。

角色相关的实现细节（隐藏重复武器、按骨骼测量归一化身高、动画 clip 的可用性降级）见 `src/components/scene/characters.ts` 的注释。
