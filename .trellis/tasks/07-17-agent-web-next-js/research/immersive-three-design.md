# Research: 全页沉浸式 Three.js 体验（musee.barvian.me 风格）落地方案

- **Query**: 如何用 Next.js 15 + r3f9 + drei10 + three0.180 做一个全页沉浸式 3D 场景（模型居中、浮动玻璃 UI、平滑运镜、氛围光照），场景内放 N 个评审机器人（RobotExpressive.glb）
- **Scope**: mixed（外部技术范式 + 本仓库现状/约束核对）
- **Date**: 2026-07-17

## 环境事实（已在本机核对，不是猜测）

| 依赖 | 版本 | 说明 |
|---|---|---|
| `next` | 15.3.0 | App Router |
| `react` / `react-dom` | 19.1.0 | |
| `@react-three/fiber` | 9.6.1 | React19 兼容线 |
| `@react-three/drei` | 10.7.7 | 下述组件全部已导出可用（已 `node -e` 核对：Environment / Lightformer / Bounds / useBounds / Stage / PresentationControls / CameraControls / ContactShadows / AccumulativeShadows / RandomizedLight / Float / Html / Clone / Center / useGLTF / useAnimations 全部 OK） |
| `three` | 0.180.0 | |
| `camera-controls` | 已随 drei 安装（`node_modules/camera-controls/dist` 存在）→ drei `<CameraControls>` 可直接用 | |
| `maath` | 已装（drei 依赖）→ 可用 `maath/easing` 做阻尼缓动 | |
| `three-stdlib` | 已装 → GLTFLoader / RGBELoader / SkeletonUtils 都在 | |
| **`postprocessing`** | **未安装** | Bloom 需要额外装（见 §3.5） |
| **`@react-three/postprocessing`** | **未安装** | 同上 |
| **`@pmndrs/assets`** | **未安装** | 与 CSP 相关（见 §3.1） |
| 模型 | `public/models/RobotExpressive.glb` 已存在 | 现有 `StageCanvas.tsx` 用 vanilla three 加载它 |

**现状**：本仓库已有一个 2D/漫画风"舞台"实现（`src/components/stage/`），其中 `StageCanvas.tsx` 用**纯 vanilla three（非 r3f）** 手动建 renderer/scene/camera，把每个机器人沿 x 轴排开。代码注释明确写道：*"r3f/drei `<View>` 方案在真实浏览器里渲染不出东西（空白舞台），所以改成 vanilla 命令式接管 renderer"*。→ **这是一个已知踩坑**：本次若改用 r3f 的 `<Canvas>`（而非 `<View>`）就没有这个问题，`<View>` 才是那个坑（见 §8）。

---

## 1. musee.barvian.me 的观感与交互（模式层面）

> 注意：本次运行环境没有可用的联网抓取工具（无 WebFetch / exa），以下为**基于该类站点通行范式的推断**，非实时抓取核实。作者 Maxime Barvian 的具体文章/repo URL 未能核实，**不臆造链接**——建议实现前人工打开该站用 DevTools 看一眼 canvas 尺寸、是否 OrbitControls、是否 postprocessing。

该类"博物馆式"沉浸站点的可复用范式（这就是我们要抄的骨架）：

1. **一块撑满视口的 `<canvas>` 作为主体**（`position: fixed; inset: 0`），3D 场景/模型是页面的"背景即主角"。
2. **模型严格居中取景**：相机对准模型几何中心，留白（负空间）大，营造"展品"感。
3. **HTML UI 以浮动卡片叠加**：半透明 / 玻璃拟态，绝对定位在角落或侧边，不铺满、不挡展品。
4. **相机是"缓动"的**：鼠标移动带来轻微视差 / 阻尼 lookAt，切换展品时相机平滑飞过去（缓动曲线 ease-in-out），而不是生硬跳变。
5. **氛围来自环境光照 + 柔和地面阴影 + 轻微 bloom/雾**，而非硬光。背景常是纯色/渐变，把注意力聚到模型。
6. **入场有过渡**（淡入、相机拉近、模型渐显）。

我们的映射：**N 个评审机器人 = N 个"展品"**，居中弧形排布；配置/输入/结果卡片 = 浮动玻璃 UI；开始评分 = 相机运镜 + 机器人播动画。

---

## 2. 全页 r3f 布局范式（推荐做法与取舍）

### 2.1 骨架：全屏 Canvas + DOM 覆盖层

**推荐：普通 DOM 绝对定位覆盖，不要用 `<Html>` 承载主 UI。** 理由：主 UI（配置面板、三个输入框、结果 Bento 卡、流式打字机）需要正常的可访问性、滚动、input 焦点、复制粘贴、`prefers-reduced-motion`——这些在普通 React DOM 里天然可用；`<Html>` 会把 DOM 塞进 CSS3D 变换层，input/滚动/无障碍都更别扭，且随相机动会抖。

`<Html>` 只留给**贴在 3D 锚点上的小标签**（每个机器人头顶的名字/分数徽章），用 `occlude` + `distanceFactor` 让它随机器人一起动。

```
app/page.tsx (client)
└─ <div class="stageRoot">           position: relative; height: 100dvh; overflow: hidden
   ├─ <SceneCanvas/>                 position: fixed inset:0; z-index:0  (client-only)
   └─ <div class="uiLayer">          position: fixed inset:0; z-index:10; pointer-events:none
        ├─ <ConfigCard/>             pointer-events:auto  (玻璃卡)
        ├─ <ProblemInputs/>          pointer-events:auto
        └─ <ResultsDeck/>            pointer-events:auto
```

**关键 CSS 技巧 — pointer-events 分流**：UI 容器 `pointer-events: none`，只有实际卡片 `pointer-events: auto`。这样卡片之间的空白处，鼠标事件会**穿透到下面的 canvas**，用户仍能拖动旋转/交互 3D 场景（这正是 musee 那种"UI 浮着但场景可玩"的手感）。

### 2.2 Next 15 + r3f 的 SSR 处理

`<Canvas>` 依赖 DOM/WebGL，不能 SSR。两种写法都行：

- **A（推荐）**：`SceneCanvas.tsx` 顶部 `"use client"`，父页面用 `next/dynamic` 且 `ssr:false` 引入它——本仓库 `Stage.tsx` 已经是这个模式（`dynamic(() => import("./StageCanvas"), { ssr: false })`），照抄即可。
- **B**：整个页面 `"use client"`，但 `<Canvas>` 仍建议 dynamic-import 以免 hydration 抖动。

三大件（`<Canvas dpr={[1,2]} shadows camera={{position,fov}}>`）都在 client 组件内。

### 2.3 取舍表

| 方案 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| 全 DOM 覆盖（绝对定位） | 无障碍/焦点/滚动天然可用；实现最简；对比度可控 | UI 不"贴"3D 物体 | **主 UI 用这个** |
| drei `<Html>` 锚点 | 标签随物体走，有 3D 纵深感 | input/滚动别扭；性能开销；随相机抖 | **只用于机器人头顶小标签** |
| 多个 `<View>` 分屏 | 一个 canvas 画多视口 | **本仓库已验证在真机渲染空白**（见注释） | **不要用** |

---

## 3. 氛围与质感（含 CSP/离线约束的关键取舍）

### 3.1 `<Environment>` —— ⚠️ 最大的 CSP 坑，必须避开

**已核对 drei 源码**（`node_modules/@react-three/drei/core/useEnvironment.cjs.js`）：`<Environment preset="city|sunset|studio|...">` 会去这个**外链 CDN** 取 HDRI：

```
https://raw.githack.com/pmndrs/drei-assets/456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri/venice_sunset_1k.hdr
```

本项目定调"CSP 禁外链资源 / 离线"，**`preset` 直接违规、离线会 404 导致场景发黑**。三条 CSP-安全 替代路径：

1. **✅ 首选：程序化 `<Environment>` + `<Lightformer>`（零网络）**。不给 `preset`/`files`，改用 children 摆几片发光面当"打光板"，drei 会把它们渲成 cubemap 当 IBL：
   ```tsx
   <Environment resolution={256}>
     {/* 顶部主光 */}
     <Lightformer intensity={2} position={[0, 5, -2]} scale={[10, 5, 1]} color="#fff5e6" />
     {/* 两侧补光/轮廓光，给机器人金属边缘 */}
     <Lightformer intensity={1} position={[-5, 1, 1]} scale={[3, 6, 1]} color="#5ab4ff" />
     <Lightformer intensity={1} position={[5, 1, 1]}  scale={[3, 6, 1]} color="#ff5c7a" />
     <color attach="background" args={["#12131c"]} />
   </Environment>
   ```
   这套既给 PBR 反射/金属质感，又不碰网络，颜色还能对齐 PRD 的舞台色板（`#12131C` 底 + 琥珀/彩色声部色）。

2. **✅ 次选：本地 HDRI**。把一张 `.hdr` 放 `public/hdri/studio.hdr`，`<Environment files="/hdri/studio.hdr" />`。同源、CSP `connect-src 'self'` 即可。体积注意：1k hdr 约 1–3MB。

3. **✅ 或装 `@pmndrs/assets` 走本地打包**（`npm i @pmndrs/assets`）：`import studio from '@pmndrs/assets/hdri/studio.exr'` → `<Environment files={studio} />`。它是打进 bundle 的 data URI，离线可用（注意：webp gainmap 预加载不支持，用 `.exr`/`.hdr`）。

> `<Environment background>` 若想直接当天空盒背景可加 `background`；但更省事是纯色/渐变背景（见 §6 对比度）。

### 3.2 打光

即便有 IBL，也补 1 盏方向光投阴影 + 环境光提亮暗部即可，别堆灯（灯越多越慢、阴影贴图越贵）：
```tsx
<ambientLight intensity={0.4} />
<directionalLight
  position={[4, 6, 3]} intensity={1.6} castShadow
  shadow-mapSize={[1024, 1024]}
  shadow-bias={-0.0002}
/>
```
性能：**只让这 1 盏方向光 `castShadow`**；`shadow-mapSize` 1024 足够，别上 2048×N。

### 3.3 地面阴影：机器人会动 → 用 `<ContactShadows>`，别用 `<AccumulativeShadows>`

- **✅ `<ContactShadows>`**：便宜、柔和、每帧刷新，**适合动画角色**。放地面：
  ```tsx
  <ContactShadows position={[0, -1.0, 0]} opacity={0.6} scale={20} blur={2.4} far={4} resolution={512} color="#000" />
  ```
- **⚠️ `<AccumulativeShadows>` + `<RandomizedLight>`**：画质最好（渐进累积软阴影），但**要求场景静止**——它多帧累积。机器人一直播 Idle/Dance 动画会让它不停重算或糊掉。除非把它做成"评分间隙静止时才累积"，否则**别用**。默认选 ContactShadows。

### 3.4 `<Float>` 漂浮 + 轻雾

- `<Float speed={1} rotationIntensity={0.3} floatIntensity={0.6}>` 包住机器人（或整排），给"悬浮氛围"。注意：**Float 会持续位移**，如果同时用 ContactShadows，阴影会跟着飘——可接受（更梦幻）；若想阴影稳，把 Float 的 `floatIntensity` 调小。
- 轻雾：`<fog attach="fog" args={["#12131c", 8, 24]} />`（挂到 scene），远处机器人淡入背景色，纵深感强、且天然把"太多机器人"的视觉噪音压下去。雾色务必等于背景色。

### 3.5 Bloom / 后期（可选，需装包）

`postprocessing` 与 `@react-three/postprocessing` **都未安装**。要 bloom 得：
```
npm i @react-three/postprocessing postprocessing
```
**版本兼容**：fiber@9 / react@19 需要 `@react-three/postprocessing` **v3.x**（v2 是 fiber8/react18 线）——安装后用 `npm ls @react-three/postprocessing` 确认解析到 3.x，否则会白屏/报 reconciler 不匹配。用法：
```tsx
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
<EffectComposer disableNormalPass>
  <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.9} luminanceSmoothing={0.2} />
  <Vignette eskil={false} offset={0.2} darkness={0.7} />
</EffectComposer>
```
**取舍**：bloom 让机器人头顶均衡器/分数徽章/发光边"会呼吸"，氛围拉满，但它是全屏 pass，移动端/集显掉帧。建议：
- 只在评分进行时开 bloom（`intensity` 用 state 缓动 0→0.6）。
- `luminanceThreshold` 调高（0.85+）只让真正很亮的发光体溢出，避免整屏发灰。
- `prefers-reduced-motion` / 专注模式下关掉 EffectComposer（条件渲染）。
- **纯 CSS 的 glow（box-shadow/filter）能替代很多"辉光"需求**——如果只是想让 UI 徽章发光，别为此引入后期管线。

### 3.6 色彩管线

`<Canvas>` 默认已是 `ACESFilmicToneMapping` + sRGB 输出（r3f 会设好）。若想更电影感可 `<Canvas gl={{ toneMapping: THREE.ACESFilmicToneMapping }} flat={false}>`。别手动改 `outputColorSpace`，用默认即可。

---

## 4. 相机与运镜

模型居中 + 平滑运镜，三选一，按"可控度"排序：

### 4.1 自动取景居中：`<Bounds>` + `useBounds`（强烈推荐做"居中"这件事）

`<Bounds>` 会测量子内容包围盒，把相机自动移到"刚好框住全部"的位置——这就是"模型居中取景"的开箱即用解。
```tsx
<Bounds fit clip observe margin={1.2}>
  <RobotLineup />   {/* 一次性框住所有机器人 */}
</Bounds>
```
- `fit` 初始自动取景；`observe` 视口/内容变化时重新取景；`margin` 留白（>1 拉远）；`clip` 自动设近远裁剪面。
- 配合 `useBounds()`：点某个机器人时 `bounds.refresh(mesh).fit()` 让相机**平滑聚焦到那个机器人**（drei 内部做缓动）。这天然就是 musee "切换展品" 的运镜。

### 4.2 交互旋转：`<PresentationControls>`（推荐做"展品可把玩"手感）

比 OrbitControls 更适合"展品"：带弹簧阻尼、限制角度、松手回中，永远不会转到看不到模型。
```tsx
<PresentationControls
  global                       // 整个画布可拖
  snap                         // 松手弹回
  polar={[-0.2, 0.4]}          // 上下限制
  azimuth={[-0.6, 0.6]}        // 左右限制
  config={{ mass: 1, tension: 170, friction: 26 }}
>
  <RobotLineup />
</PresentationControls>
```

### 4.3 电影运镜：`<CameraControls>`（camera-controls 已装）

要"开始评分时相机飞过去/推近某机器人"这种脚本化运镜，用它最顺（`camera-controls` 已随 drei 装好）：
```tsx
const controls = useRef<CameraControlsImpl>(null);
// 平滑飞到目标（enableTransition=true 即缓动）
controls.current.setLookAt(px,py,pz,  tx,ty,tz,  true);
controls.current.fitToBox(mesh, true, { paddingTop:0.5, ... }); // 平滑框住某物体
<CameraControls ref={controls} makeDefault minDistance={3} maxDistance={12} />
```
可配 GSAP（已装 gsap@3.13）驱动 `setLookAt` 的中间量做更定制的缓动曲线。

### 4.4 轻量视差（无需库）

只想要"鼠标动、相机轻微跟"的氛围，不必上控件，`useFrame` + `maath/easing`（已装）阻尼：
```tsx
import { easing } from "maath";
useFrame((state, dt) => {
  easing.damp3(
    state.camera.position,
    [state.pointer.x * 0.6, 0.5 + state.pointer.y * 0.3, 8],
    0.4, dt
  );
  state.camera.lookAt(0, 0, 0);
});
```

**推荐组合**：`<Bounds>`（居中） 外套 `<PresentationControls>`（把玩），评分脚本运镜临时切 `<CameraControls>.setLookAt`。别同时挂两个 `makeDefault` 的控件。

---

## 5. N 个机器人的优雅排布（弧形/环形，居中不重叠）

**推荐：面向相机的浅弧（arc），奇数居中、偶数对称**。每个机器人在半径 R 的弧上，绕原点分布并各自朝里转一点，既有纵深又不互相遮挡：

```tsx
function RobotLineup({ agents }: { agents: Agent[] }) {
  const N = agents.length;
  const R = 6;                       // 弧半径
  const spread = Math.min(Math.PI * 0.5, 0.32 * N); // 总张角，随人数自适应，封顶 90°
  return (
    <group>
      {agents.map((a, i) => {
        const t = N === 1 ? 0 : i / (N - 1) - 0.5;   // -0.5..0.5
        const angle = t * spread;
        const x = Math.sin(angle) * R;
        const z = Math.cos(angle) * R - R;           // 弧心在原点前方，机器人略微包住相机
        return (
          <group key={a.id} position={[x, 0, z]} rotation={[0, -angle, 0]}>
            <Robot agent={a} />
          </group>
        );
      })}
    </group>
  );
}
```

要点：
- **`rotation-y = -angle`** 让每个机器人转向弧心/相机，视觉上"围成半圆看着你"。
- 用 **`<Center>`** 先把单个机器人几何原点对齐脚底/中心，再排布，避免高低不齐。
- 外层用 **`<Bounds fit observe>`** 一次性框住整排 → 增删机器人时相机自动重新取景居中（配合 PRD 的"动态增删 Agent"）。
- 排太多（>6）就把 `spread` 收窄 + 加雾（§3.4）让两端淡出，或改**双排/环形**（后排 z 更远、y 略高做阶梯）。
- 备选布局：**环形**（`angle = i/N * 2π` 整圈）适合"制作人居中、评审围一圈"，但相机要能转/或只用来做汇总 Agent 居中特写。**一排直线**最简单但纵深弱、人多会挤——加透视缩放可救。

**模型克隆（关键）**：RobotExpressive 是 **SkinnedMesh**，`useGLTF` 出来的 scene **不能直接多次 `<primitive>` 复用**（骨骼会共享/错乱）。两条正路：
- drei **`<Clone>`**：`<Clone object={gltf.scene} />` —— drei 内部用 SkeletonUtils 正确克隆骨骼。每个机器人一个 `<Clone>`。
- 或手动 `SkeletonUtils.clone(gltf.scene)`（`three-stdlib` 已装，现有 `StageCanvas.tsx` 就是这么做的）再对 clone 挂 `useAnimations`。
- 动画：每个 clone 独立 `useAnimations(gltf.animations, cloneRef)`，按状态 `actions["Idle"].play()` / 切 `Dance`/`ThumbsUp`/`No`——现有 vanilla 版的 `CLIP_LIST = ["Idle","Dance","ThumbsUp","Death","No"]` 可直接映射到 idle/win/lose/streaming 状态。

---

## 6. 浮动玻璃卡片 UI（叠加 + 可读 + 不挡模型）

### 6.1 布局策略（不挡展品）

- 机器人居中在**视口中央偏下/中**，UI 卡片走**四周与侧栏**，中间留空给展品：配置面板贴**左上/左侧**，题目/笔记/答案输入贴**右侧或底部抽屉**，结果 Bento 卡评分后从**底部滑入**。
- 卡片最大宽度限制（`max-width: 380px`），别铺满；用 `pointer-events:auto`（容器 none，见 §2.1）。

### 6.2 玻璃拟态 + 对比度（3D 背景上文字易糊，这是重点）

```css
.glassCard {
  background: rgba(18, 19, 28, 0.55);      /* 关键：底色偏暗且半不透明，保证文字对比 */
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  color: #F5F1E6;                           /* 奶油文字，对齐 PRD 色板 */
}
```
**可读性铁律**（玻璃卡在动态 3D 上最容易翻车）：
1. **不要透明到能看清后面机器人**——文字区背景至少 `rgba(...,0.5)` 起，或在文字块下再垫一层 `rgba(0,0,0,0.35)` 局部 scrim。目标 WCAG AA：正文对比 ≥ 4.5:1。
2. `backdrop-filter` **性能**：每张卡都是一次离屏模糊合成，卡多/面积大 + 全屏 WebGL 会掉帧。→ **控制玻璃卡数量（≤3~4 张）**，别给一堆小徽章都上 blur；徽章用实心色 + box-shadow 即可。
3. **Safari 需 `-webkit-backdrop-filter`**；某些浏览器 `backdrop-filter` 与 `overflow`/`border-radius` 有裁剪 bug，必要时给卡片加 `isolation: isolate`。
4. 背景别用高频花哨环境——**纯深色/暗渐变背景**（§3.1 `<color>`）能让玻璃 UI 又通透又可读。若 §3.5 开了 bloom，注意亮机器人飘到卡片后会降低文字对比，可给卡加更实的底。
5. `prefers-reduced-transparency` / 专注模式：一键把 `backdrop-filter` 关掉、背景转实心（无障碍 + 低端机兜底），这与 PRD 已有的"专注模式/reduced-motion 开关"一致。

### 6.3 机器人头顶标签用 `<Html>`

名字/分数徽章贴机器人头顶，随其运动：
```tsx
<Html position={[0, 2.4, 0]} center distanceFactor={10} occlude="blending"
      style={{ pointerEvents: "none" }}>
  <div className="nameTag">{agent.name}</div>
</Html>
```
`occlude` 让被其他机器人挡住时标签淡出；`distanceFactor` 让标签随远近缩放（有纵深）。这类**小标签**用 `<Html>` 合适；大块输入/结果仍走普通 DOM（§2.1）。

---

## 7. 参考 examples（核实可用的入口）

> 逐条外链未在本次环境联网核实真伪，但以下均为长期存在的官方/知名入口，可作为落地参考起点：

| 链接 | 关键技术点 |
|---|---|
| https://r3f.docs.pmnd.rs/getting-started/examples | r3f 官方示例总集（含 camera transition、bounds、environment 等） |
| https://drei.docs.pmnd.rs/ | drei 组件 storybook：`Environment`/`Lightformer`/`Bounds`/`Stage`/`PresentationControls`/`CameraControls`/`ContactShadows`/`AccumulativeShadows`/`Float`/`Html` 每个都有 live demo + props |
| https://github.com/pmndrs/drei | 源码 + README，各组件 props 权威来源 |
| https://github.com/pmndrs/react-postprocessing | Bloom/Vignette/DOF 用法与版本兼容说明 |
| https://github.com/pmndrs/camera-controls | `setLookAt`/`fitToBox`/`dollyTo` 等运镜 API（drei `<CameraControls>` 的底层） |
| pmndrs codesandbox 官方合集（drei storybook "PresentationControls"、"Bounds and makeDefault"、"Camera transitions"、"Environment"） | 手表/球体展品把玩、点选聚焦运镜、程序化环境光 |
| Bruno Simon `threejs-journey.com` 的 r3f 章节示例 | 全屏 canvas + 模型居中 + 环境光 的标准工程结构 |
| musee.barvian.me（Maxime Barvian） | 目标观感参考本体——建议用 DevTools 亲自看：canvas 尺寸/是否 OrbitControls/是否 EffectComposer/HDRI 来源 |

（Maxime Barvian 的具体技术拆解文章/开源 repo 未能核实到确切 URL，**不臆造**；如需，去他站点 footer / 其 GitHub `barvian` 查证。）

---

## 8. 对本项目的落地建议与坑（务必读）

**架构落地建议**
1. 新建 `src/components/scene/`（与旧 `stage/` 2D 版并存或替换），核心：`SceneCanvas.tsx`（`"use client"`，`dynamic ssr:false` 引入）、`RobotLineup.tsx`、`Robot.tsx`、`SceneEnvironment.tsx`。
2. `<Canvas shadows dpr={[1,2]} camera={{ position:[0,1.2,9], fov:38 }}>`。用 `<Suspense fallback={...}>` 包 GLB 加载。
3. 居中用 `<Bounds fit clip observe margin={1.15}>`，把玩用外层 `<PresentationControls>`，脚本运镜临时 `<CameraControls>.setLookAt`。
4. 环境用**程序化 `<Environment>`+`<Lightformer>`**（§3.1 方案1，零网络）+ 1 盏投影方向光 + `<ContactShadows>` + 可选 `<fog>`。
5. 机器人：`useGLTF("/models/RobotExpressive.glb")` + 每个用 `<Clone>`（或 SkeletonUtils.clone）+ 各自 `useAnimations` 映射 idle/streaming(Dance)/win(ThumbsUp)/lose(No/Death) —— 状态源接现有评分流（`useStreamingGrade.ts` / `Performer.status`）。
6. UI 走普通 DOM 覆盖层（§2.1 pointer-events 分流），机器人头顶小标签用 `<Html>`。

**坑（按严重度）**
1. **CSP/离线 vs `<Environment preset>`**：`preset` 会拉 `raw.githack.com` 外链（已核对源码），离线/严格 CSP 下场景变黑。→ 用 Lightformer 程序化，或本地 `.hdr`/`@pmndrs/assets`。同理 drei `<Stage>` 组件默认 `environment="city"` 也走外链，用它要传 `environment={null}` 或自定义。
2. **`<View>` 在本仓库已证实渲染空白**（`StageCanvas.tsx` 注释）。本次用整块 `<Canvas>` 而非 `<View>` 多视口——别重蹈覆辙。若坚持多 canvas，注意 WebGL context 上限（浏览器约 8~16 个），N 个机器人各一 canvas 会爆 context，**必须共用一个 Canvas**。
3. **SkinnedMesh 克隆**：直接 `<primitive object={gltf.scene}>` 放多份 → 骨骼共享、动画互相污染/只显示一个。必须 `<Clone>` 或 `SkeletonUtils.clone`。
4. **Next SSR**：`three`/`<Canvas>` 不能 SSR，忘了 `"use client"` + `ssr:false` 会 `window is not defined` 或 hydration mismatch。沿用现有 dynamic 模式。
5. **postprocessing 未装 + 版本线**：要 bloom 得装 `@react-three/postprocessing@3` + `postprocessing`（v3 才配 fiber9/react19；装到 v2 会崩）。能用 CSS glow 就别引后期管线。
6. **性能**：`dpr` 封顶 2；只 1 盏灯投影、`shadow-mapSize`≤1024；`backdrop-filter` 玻璃卡 ≤3~4 张；bloom 只在评分时开、reduced-motion 关；机器人多时开 `<fog>` + 收窄弧张角。移动端按 PRD 降级为静态（可直接不挂 Canvas，回退 2D 卡片）。
7. **`prefers-reduced-motion` / 专注模式**（PRD 硬要求）：reduced-motion 时停机器人待机晃动/Float/相机视差/bloom，玻璃转实心背景。把"炫"与"读"解耦，别让运镜挡住漏点清单。
8. **别同时两个 `makeDefault` 控件**（PresentationControls 内部也控相机 + CameraControls `makeDefault` 会打架）——切换时只激活一个。

## Caveats / Not Found

- **musee.barvian.me 未实时抓取**：本环境无联网抓取工具，§1 与 §7 中该站的具体实现（是否用 r3f、HDRI 来源、是否 postprocessing、相机控件类型）为**推断**，需人工用 DevTools 核实。Maxime Barvian 的技术文章/repo 确切 URL 未核实到，故未列具体链接以免臆造。
- 外链 example URL 未逐个联网验活，但均为长期存在的官方/知名入口。
- 所有 **r3f/drei/three API、drei 组件可用性、Environment 外链 CDN 行为、camera-controls/maath 是否已装、postprocessing 未装** 等结论均在本机 `node_modules` 实测核对，可信。
