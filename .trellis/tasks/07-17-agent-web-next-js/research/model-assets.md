# Research: 3D 角色模型资源（RobotExpressive 之外的候选）

- **Query**: 找可用于「评审剧场」的 3D 角色模型，要求 glTF/GLB + 自带情绪/手势骨骼动画 + 宽松许可 + 可直链下载
- **Scope**: external（实地下载验证）
- **Date**: 2026-07-17

## 验证方法

所有候选均用 `curl -sL` 下到 scratchpad，确认 HTTP 200 + 前 4 字节为 `glTF` (`676c5446`) + glTF v2 + header 声明长度与实际字节数一致（全部 OK，无截断），再用 node 解析 GLB JSON chunk 得到**真实动画名 / 材质名 / 网格 / bbox**。下文动画名均为解析结果，非臆造。

下载暂存目录（**未**入库 `public/models/`）：
`/private/tmp/claude-501/-Users-napstablook-Project-Fuck-AI-Marking/6c9f7ad2-369c-425b-a31f-454de0463e8e/scratchpad/models/`

---

## 结论速览

| 候选 | 直链 | 体积 | 动画数 | 四态覆盖 | 许可 | 判定 |
|---|---|---|---|---|---|---|
| **KayKit Adventurers**（Knight/Mage/Barbarian/Rogue） | ✅ raw.githubusercontent | 3.4–3.5MB | **76** | ✅ 全覆盖 | CC0 | **推荐 #1** |
| **KayKit Skeletons**（Skeleton_Warrior 等） | ✅ raw.githubusercontent | 4.6MB | **95** | ✅ 全覆盖 + `Taunt` | CC0 | **推荐 #2** |
| three.js **Xbot** | ✅ raw.githubusercontent | 2.79MB | 7 | ⚠️ 缺庆祝 | (见许可栏) | 备选 |
| three.js **Soldier** | ✅ | 2.06MB | 4 | ❌ 无情绪动画 | — | **不合格** |
| three.js **Michelle** | ✅ | 3.13MB | 2 | ❌ 只有 Samba+TPose | — | **不合格** |
| **Quaternius** 动画角色 | ❌ itch.io JS 门控 | — | — | — | CC0 | **不可用（无直链）** |
| **Poly Pizza API** | ❌ HTTP 401 | — | — | — | — | **不可用（需 key）** |

---

## 基线：现用 RobotExpressive（解析结果）

- 体积 0.44MB，14 animations
- `ANIM`: `Dance, Death, Idle, Jump, No, Punch, Running, Sitting, Standing, ThumbsUp, Walking, WalkJump, Wave, Yes`
- `MAT`: `Grey`(0.37,0.37,0.33) / **`Main`(0.59,0.29,0.04 橙)** / `Black`(0.046³)
- **关键**：`Main` 是一个**纯色 baseColorFactor 材质、无贴图** → 这正是现在能按评审 accent 染色的原因。**所有候选都不具备这个性质**（见坑）。

---

## 候选 1：KayKit Character Pack — Adventurers（推荐 #1）

- **来源**：Kay Lousberg，GitHub 官方镜像 `KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0`
- **直链**（curl 可得，HTTP 200 已验证）：
  ```
  https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb
  .../gltf/Mage.glb   .../gltf/Barbarian.glb   .../gltf/Rogue.glb   .../gltf/Rogue_Hooded.glb
  ```
- **体积**：Knight 3.49MB / Mage 3.42MB / Barbarian 3.45MB / Rogue 3.45MB
- **许可**：**CC0 1.0**。LICENSE.txt 原文：*"License: (Creative Commons Zero, CC0) … This content is free to use in personal, educational and commercial projects."*，README 明确 *"no attribution required"*。**无需署名、可再分发**。
- **材质**：Knight → `knight_texture`（单一材质，`baseColorTexture=image#0`，1 张 1024×1024 PNG gradient atlas，**无 baseColorFactor**）。Mage/Barbarian/Rogue 同构（`mage_texture` 等）。
- **skins**: 1，**nodes**: 57，**风格**：低多边形 + 渐变 atlas 上色，暗色舞台友好。
- **真实动画名（76 个，解析所得）**：
  `1H_Melee_Attack_Chop, 1H_Melee_Attack_Slice_Diagonal, 1H_Melee_Attack_Slice_Horizontal, 1H_Melee_Attack_Stab, 1H_Ranged_Aiming, 1H_Ranged_Reload, 1H_Ranged_Shoot, 1H_Ranged_Shooting, 2H_Melee_Attack_Chop, 2H_Melee_Attack_Slice, 2H_Melee_Attack_Spin, 2H_Melee_Attack_Spinning, 2H_Melee_Attack_Stab, 2H_Melee_Idle, 2H_Ranged_Aiming, 2H_Ranged_Reload, 2H_Ranged_Shoot, 2H_Ranged_Shooting, Block, Block_Attack, Block_Hit, Blocking, Cheer, Death_A, Death_A_Pose, Death_B, Death_B_Pose, Dodge_Backward, Dodge_Forward, Dodge_Left, Dodge_Right, Dualwield_Melee_Attack_Chop, Dualwield_Melee_Attack_Slice, Dualwield_Melee_Attack_Stab, Hit_A, Hit_B, Idle, Interact, Jump_Full_Long, Jump_Full_Short, Jump_Idle, Jump_Land, Jump_Start, Lie_Down, Lie_Idle, Lie_Pose, Lie_StandUp, PickUp, Running_A, Running_B, Running_Strafe_Left, Running_Strafe_Right, Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_Pose, Sit_Chair_StandUp, Sit_Floor_Down, Sit_Floor_Idle, Sit_Floor_Pose, Sit_Floor_StandUp, Spellcast_Long, Spellcast_Raise, Spellcast_Shoot, Spellcasting, T-Pose, Throw, Unarmed_Idle, Unarmed_Melee_Attack_Kick, Unarmed_Melee_Attack_Punch_A, Unarmed_Melee_Attack_Punch_B, Unarmed_Pose, Use_Item, Walking_A, Walking_B, Walking_Backwards, Walking_C`

### 状态机映射（四态全覆盖）

| 我们的状态 | KayKit 动画 |
|---|---|
| pending | `Idle` / `Unarmed_Idle` / `Sit_Chair_Idle` |
| streaming（争论） | `Spellcasting` / `Spellcast_Raise` / `Interact` / `Throw` / `Unarmed_Melee_Attack_Punch_A/B` / `Block_Attack` |
| done 高分 | **`Cheer`** / `Jump_Full_Short` |
| done 低分 | **`Death_A` / `Death_B`** / `Hit_A` / `Lie_Down` |

`Cheer` + `Death_A/B` 是直接对上 ThumbsUp/Death 的语义对位，比 RobotExpressive 更细腻（有 `Hit_A/B` 可做"被反驳"）。

---

## 候选 2：KayKit Character Pack — Skeletons（推荐 #2，多角色混搭）

- **直链**（HTTP 200 已验证）：
  ```
  https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0/main/addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Warrior.glb
  .../gltf/Skeleton_Mage.glb   .../gltf/Skeleton_Minion.glb   .../gltf/Skeleton_Rogue.glb
  ```
- **体积**：Skeleton_Warrior 4.64MB（Mage 4.54 / Minion 4.59 / Rogue 4.60，按 repo tree size）
- **许可**：**CC0 1.0**（LICENSE.txt 已 curl 确认同文本）
- **材质**：`skeleton`（atlas 贴图）+ **`Glow`（无贴图、无 baseColorFactor）** ← **这个 `Glow` 材质可以当"主体色"按 accent 染色**（眼睛/发光部位），是 KayKit 里唯一天然可染的材质槽。
- **网格**：`Skeleton_Warrior_ArmLeft, _Helmet, _ArmRight, _Body, _Cloak, _Eyes, _Head, _Jaw`（**分部位网格**，好做局部换色/隐藏）
- **真实动画名（95 个）**：在 Adventurers 76 个基础上**多出**：
  `Idle_B, Idle_Combat, Taunt, Taunt_Longer, Death_C_Pose, Death_C_Skeletons, Death_C_Skeletons_Resurrect, Skeletons_Awaken_Floor, Skeletons_Awaken_Floor_Long, Skeletons_Awaken_Standing, Skeleton_Inactive_Standing_Pose, Skeletons_Inactive_Floor_Pose, Spawn_Air, Spawn_Ground, Spawn_Ground_Skeletons, Spellcast_Summon, Running_C, Walking_D_Skeletons, 1H_Melee_Attack_Jump_Chop`
- **亮点**：**`Taunt` / `Taunt_Longer`** 极贴合"评审争论/嘲讽"；`Skeletons_Awaken_Standing` 可做评审"入场/上线"，`Death_C_Skeletons_Resurrect` 可做"改判/重评"。
- **注意**：与 Adventurers **同一套骨骼命名 + 同名动画基集** → 两包可混用同一套状态机映射，非常适合"每个评审不同角色"。

---

## 候选 3：three.js Xbot（备选，不推荐替换）

- **直链**：`https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb`（HTTP 200，2.79MB）
- **动画（7）**：`agree, headShake, idle, run, sad_pose, sneak_pose, walk`
- **材质**：`Beta_Joints_MAT`(0.33,0.12,0.10) / `asdf1:Beta_HighLimbsGeoSG2`(0.84,0.30,0.26) — **均为纯色 baseColorFactor 无贴图 → 可直接染色**（这点优于 KayKit）
- **BBOX**: min(-0.90, -0.00, -0.14) max(0.90, 1.81, 0.18) → **脚在原点，height≈1.81**，很干净
- **判定**：⚠️ **勉强不合格**。`agree`/`headShake` 覆盖手势、`sad_pose` 覆盖沮丧、`idle` 覆盖待机，但**没有任何庆祝动画**（无 cheer/thumbsup/jump），done 高分态无法映射。且 `sad_pose`/`sneak_pose` 是 **pose（静态单帧姿势）**而非循环动画。
- **许可**：three.js 仓库为 MIT，但 Xbot/Soldier/Michelle 源自 **Mixamo/Adobe**（`Beta_...`、`vanguard_`、`Ch03_` 均为 Mixamo 命名特征）。three.js examples 的模型各自带 README/来源说明，**Mixamo 资产的再分发条款与 MIT 不等价**（Mixamo 许可要求账号获取、限制再分发角色本体）。⚠️ **许可存疑，不建议入库**——这也是它排在 KayKit 之后的第二个理由。

---

## 不合格 / 不可用（如实记录）

| 项 | 原因（实测） |
|---|---|
| **three.js Soldier** | 动画仅 `Idle, Run, TPose, Walk` — **只有 walk/run，无任何情绪/手势** → 明确不合格（且 Mixamo 来源存疑） |
| **three.js Michelle** | 动画仅 `SambaDance, TPose` — 无 idle/庆祝/沮丧 → 不合格 |
| **Quaternius**（Ultimate Animated Character 等） | 许可是 CC0，但 `quaternius.com/packs/*.html` 页面**下载按钮由 itch.io JS widget (`Itch.attachBuyButton`) 渲染，HTML 里无任何 zip/glb 直链**；`quaternius.itch.io/animated-robot` 返回 **HTTP 404**（slug 不对且需经 itch 下载页）。`https://quaternius.com/packs/ultimateanimatedcharacter(s).html` 均 **404**。→ **无稳定 curl 直链，不满足标准 4**。若要用需人工从 itch.io 下载后手动入库。 |
| **Poly Pizza API** | `https://api.poly.pizza/v1/search/...` → **HTTP 401**，需 API key → 不满足标准 4 |
| **Kenney** | 其 CC0 角色包（如 Blocky Characters）为静态/无骨骼情绪动画，未通过标准 2；未下载验证（无带情绪动画的角色包） |
| **Khronos glTF-Sample-Assets** | 148 个模型中角色类仅 `CesiumMan`(仅走路)、`RiggedFigure`(仅走路)、`BrainStem`、`Fox`(Survey/Walk/Run) — **均无庆祝/沮丧语义** → 不合格 |

---

## 坑（重要）

1. **最大的坑：KayKit 没有"纯色主体材质"，accent 染色方式必须改。**
   现在 RobotExpressive 靠 `Main` 这个**纯色无贴图** `baseColorFactor` 材质染 accent。KayKit 每个角色**只有 1 个材质 + 1 张 1024×1024 gradient atlas 贴图**（README 原文确认："Textured using a single gradient atlas texture (1024x1024)"）。后果：
   - `material.color.set(accent)` 在 three.js 中会与 `map` **相乘**，等于给**整个角色**蒙一层色（帽子、皮肤、武器全变），不是"主体色"局部染色。
   - 可行替代：① 用 **Skeletons 包的 `Glow` 材质**（无贴图，可纯色染）做 accent；② 每个评审用**不同角色**（Knight/Mage/Barbarian/Rogue/Skeleton×4 = 8 种）而非同角色染不同色 —— 这也正是"多角色混搭"的天然方案；③ 运行时按 accent 对 atlas 做 hue-shift（成本高）。
2. **Adventurers 的 bbox 下探到 y≈-1.12**（Knight/Barbarian/Rogue min.y=-1.12，Mage min.y=-1.16）——**脚不在原点**，注意这是 pre-skin 的 local bbox（含武器/配件网格），落地需实测 `Box3.setFromObject()` 后再对齐，不能直接假设 y=0。相比之下 **Skeleton_Warrior min.y=-0.00（脚在原点，height≈2.17）**、Xbot min.y=-0.00（height≈1.81），更干净。
3. **尺度差异**：RobotExpressive 的 local bbox 只有 ±0.03（靠节点缩放放大），KayKit 高约 2.2 单位、Xbot 高约 1.81 单位。**混用需统一归一化**（按实测高度缩放到同一目标身高），否则围圈时高矮失控。
4. **体积**：KayKit 单角色 3.4–4.6MB vs RobotExpressive 0.44MB，**约 8–10 倍**。N 个评审若加载 N 个不同角色，首屏可能 20–40MB。建议：同一 GLB 复用 + `SkeletonUtils.clone()`；或用 gltf-transform 做 Draco/WebP 压缩（atlas 可降采样到 128×128，README 明确说支持）。
5. **朝向**：KayKit 根节点名为 `Rig`，**无 scale/rotation/translation 覆盖**（均 undefined = 单位变换），需在 three.js 里实测朝向；未在本次静态解析中确认是否 +Z 朝前。
6. **`*_Pose` 后缀动画是单帧静态姿势**（`Death_A_Pose`, `Lie_Pose`, `Unarmed_Pose`, `T-Pose`），**不要当循环动画播**，要用 `Death_A` 这类带 `_A/_B` 的正式动画。Xbot 的 `sad_pose`/`sneak_pose` 同理。
7. **`T-Pose` 混在动画列表里**（KayKit 和 Soldier/Michelle 都有），做"随机挑一个动画"时**必须过滤掉**，否则评审会突然变成 T 字。

---

## 推荐排序

1. **KayKit Adventurers（Knight 优先）** — 直接加进来或替换机器人。CC0 无署名、76 动画、`Idle/Cheer/Death_A/Spellcasting` 四态精准对位，语义比 RobotExpressive 更丰富。唯一代价是 accent 染色策略要改。
2. **KayKit Skeletons（Skeleton_Warrior）** — **多角色混搭首选**。与 Adventurers 同骨骼/同名动画基集，一套状态机通吃；多 `Taunt`（争论神器）；且 `Glow` 材质是**唯一能直接按 accent 染色的纯色材质槽**。脚在原点，最干净。
3. **three.js Xbot** — 仅在"必须保留纯色可染材质"时作备选，但**缺庆祝动画** + **Mixamo 许可存疑**，不建议入库。

> 组合建议：8 个 KayKit 角色（4 Adventurers + 4 Skeletons）足以让 N 个评审各具形象，用"换角色"替代"染 accent 色"，同时保留 Skeletons 的 `Glow` 槽做 accent 点缀。

## Caveats / Not Found

- 未在浏览器/three.js 中实际渲染验证**朝向（是否 +Z 朝前）**与**落地对齐**，bbox 数据来自 GLB 静态 JSON 的 POSITION accessor min/max（pre-skin，含配件），实际渲染包围盒可能不同。
- Skeleton_Mage/Minion/Rogue 与 Barbarian/Rogue_Hooded **未逐一下载解析动画**（仅 Warrior/Knight/Mage 全解析；Barbarian/Rogue 只解析了材质与 bbox）。因同包同骨骼，动画集**推定**一致但未逐个证实。
- Quaternius CC0 角色**未能下载**，故其动画名**未知**——未臆造。若人工从 itch.io 取得可再补验。
- Kenney 角色包未下载验证（初筛即判定缺情绪动画）。
- three.js Xbot/Soldier/Michelle 的具体上游许可**未逐一核实各自 README**，仅依据 Mixamo 命名特征判定"存疑"。
