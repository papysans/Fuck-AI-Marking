# Research: Spider-Verse Comic FX — Pure CSS/SVG Recipes

- **Query**: 复刻《蜘蛛侠：平行宇宙》漫画书动画美学，纯 CSS/SVG 程序化自制，工程配方
- **Scope**: external (technique recipes) + project design-token integration
- **Date**: 2026-07-17

## Design Tokens (assumed available as CSS vars)

```css
:root {
  --bg-indigo: #12131c;
  --amber:     #ffc24b;
  --coral:     #ff5c7a;
  --mint:      #57e0a6;
  --sky:       #5ab4ff;
  --violet:    #b98bff;
  --cream:     #f5f1e6;
  /* per-agent accent, set 1..6 on wrapper */
  --agent-1: var(--amber);
  --agent-2: var(--coral);
  --agent-3: var(--mint);
  --agent-4: var(--sky);
  --agent-5: var(--violet);
  --agent-6: var(--cream);
}
```

## Global Rules (read first)

- **Only animate `transform` / `opacity`.** Everything below obeys this except two
  deliberate exceptions (feTurbulence `baseFrequency`, `feDisplacementMap` scale) which
  are SVG-filter attribute animations, not layout/paint on the main compositor — keep those
  filters on *small, isolated* SVG nodes, never full-viewport.
- **`will-change`**: add ONLY on elements that are about to animate, and remove after.
  Never leave `will-change: transform` on hundreds of static nodes — it burns GPU memory.
  Prefer applying it on `:hover`/state class, not the base rule.
- **Every keyframe animation is wrapped by the reduced-motion guard** at the bottom.
  Copy the single global block once; it disables everything via attribute selector.

### One-shot prefers-reduced-motion kill switch (paste once, globally)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
  /* freeze SVG SMIL animations */
  animate, animateTransform, animateMotion { display: none; }
  /* neutralize the boiling / aberration filters */
  .fx-boil { filter: none !important; }
  .fx-aberration { text-shadow: none !important; }
}
```
> Note: `<animate>` is disabled by hiding it (SMIL keeps last computed or base value).
> For JS-driven SVG filters, also gate with `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.

---

## 1. Halftone / Ben-Day Dots + pulsing/flowing animation

### 1a. Pure-CSS halftone via `radial-gradient` (cheapest, GPU-friendly)

```css
.halftone {
  position: relative;
  background: var(--bg-indigo);
}
.halftone::after {
  content: "";
  position: absolute; inset: 0;
  pointer-events: none;
  /* one dot per 8px cell; dot radius grows with the color stop */
  background-image: radial-gradient(var(--amber) 22%, transparent 23%);
  background-size: 8px 8px;
  background-position: 0 0;
  mix-blend-mode: screen;   /* additive over dark indigo */
  opacity: .18;
}
```

**"Flowing" dots** — animate `background-position` is fine (it's a cheap paint on a
composited overlay), but for strict transform-only, put the dots on a 2x-size layer and
translate it:

```css
.halftone::after { width: 200%; height: 200%; }
@keyframes halftone-flow {
  from { transform: translate3d(0,0,0); }
  to   { transform: translate3d(-8px,-8px,0); }  /* exactly one cell = seamless loop */
}
.halftone.is-live::after {
  animation: halftone-flow 1.2s steps(6) infinite;
  will-change: transform;
}
```

**"Pulsing" dots (dot size breathing)** — you cannot transform gradient stops, so scale the
whole overlay a hair. Keep it subtle:

```css
@keyframes halftone-pulse {
  0%,100% { transform: scale(1);    opacity: .18; }
  50%     { transform: scale(1.06); opacity: .26; }
}
.halftone.is-pulse::after {
  transform-origin: center;
  animation: halftone-pulse 900ms ease-in-out infinite;
  will-change: transform, opacity;
}
```

### 1b. SVG `<pattern>` halftone (crisper, supports true dot-radius animation)

```html
<svg class="halftone-svg" width="100%" height="100%" aria-hidden="true">
  <defs>
    <pattern id="bd" width="10" height="10" patternUnits="userSpaceOnUse">
      <circle cx="5" cy="5" r="2" fill="#ffc24b">
        <!-- true Ben-Day pulse: radius jumps, not scaled -->
        <animate attributeName="r" values="1.4;2.6;1.4" dur="1s"
                 repeatCount="indefinite" calcMode="discrete" keyTimes="0;0.5;1"/>
      </circle>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#bd)" opacity="0.2"/>
</svg>
```
> Perf: SVG pattern re-rasterizes on `r` change — keep the SVG element small or use `calcMode="discrete"` (fewer frames). For large areas prefer recipe **1a**.

---

## 2. Chromatic Aberration / RGB channel offset

### 2a. Static, on text (`text-shadow` triad — zero animation cost)

```css
.fx-aberration {
  color: var(--cream);
  text-shadow:
    -2px 0 rgba(255,92,122,.9),   /* coral = red-ish channel left  */
     2px 0 rgba(90,180,255,.9);   /* sky   = blue-ish channel right */
}
```

### 2b. Static on any element (`filter` drop-shadow stack)

```css
.fx-aberration-box {
  filter:
    drop-shadow(-2px 0 rgba(255,92,122,.6))
    drop-shadow( 2px 0 rgba(90,180,255,.6));
}
```

### 2c. Slight jitter (transform-only via layered pseudo-elements + blend)

Split into 3 stacked copies, translate two of them by sub-pixel with `steps`:

```css
.glitch { position: relative; color: var(--cream); }
.glitch::before, .glitch::after {
  content: attr(data-text);
  position: absolute; inset: 0;
  mix-blend-mode: screen;
}
.glitch::before { color: var(--coral); }
.glitch::after  { color: var(--sky);  }
@keyframes ab-jit-r { 0%,100%{transform:translate(-1.5px,0)} 50%{transform:translate(-2.5px,.5px)} }
@keyframes ab-jit-b { 0%,100%{transform:translate( 1.5px,0)} 50%{transform:translate( 2.5px,-.5px)} }
.glitch.is-live::before { animation: ab-jit-r 120ms steps(2) infinite; will-change: transform; }
.glitch.is-live::after  { animation: ab-jit-b 120ms steps(2) infinite; will-change: transform; }
```
> `steps(2)` gives the hard 2-frame comic flicker instead of smooth slide. Only add `is-live` during a moment (e.g. score reveal), then remove to drop `will-change`.

---

## 3. Radial speed lines / action lines (score-reveal burst)

### 3a. `conic-gradient` (single element, animatable via `transform: rotate`)

```css
.speed-lines {
  position: absolute; inset: -20%;
  pointer-events: none;
  background: repeating-conic-gradient(
    from 0deg at 50% 50%,
    var(--cream) 0deg 0.6deg,
    transparent  0.6deg 3deg
  );
  /* fade center → edge so lines emanate from focus */
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 18%, #000 55%);
          mask-image: radial-gradient(circle at 50% 50%, transparent 18%, #000 55%);
  opacity: 0;
}
@keyframes lines-burst {
  0%   { opacity: 0; transform: scale(1.15) rotate(0deg); }
  15%  { opacity: .9; }
  100% { opacity: 0; transform: scale(1)    rotate(-4deg); }
}
.speed-lines.is-reveal {
  animation: lines-burst 620ms ease-out forwards;
  will-change: transform, opacity;
}
```
> Subtle `rotate(-4deg)` over the burst reads as "impact swirl". Keep `inset:-20%` so rotation never exposes empty corners.

### 3b. SVG variant (sharper lines, per-agent color via `currentColor`)

```html
<svg viewBox="0 0 100 100" class="speed-svg" style="color:var(--agent-2)" aria-hidden="true">
  <g stroke="currentColor" stroke-width="0.5">
    <!-- generate N lines in JS/loop; example spokes -->
    <line x1="50" y1="50" x2="50" y2="0"/>
    <line x1="50" y1="50" x2="100" y2="50"/>
    <!-- ...rotate copies... -->
  </g>
</svg>
```
Prefer 3a unless you need crisp vector spokes; conic-gradient is one composited layer.

---

## 4. Boiling-line (hand-drawn wobble outline) — feTurbulence + feDisplacementMap

The signature Spider-Verse "everything vibrates" look. Animate `baseFrequency` in **discrete
steps between 2–3 seeds** so the outline snaps between hand-drawn frames rather than melting.

```html
<svg width="0" height="0" aria-hidden="true">
  <filter id="boil" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="1"
                  seed="1" result="noise">
      <!-- 3-frame boil: discrete jumps = on-3s hand-drawn shimmer -->
      <animate attributeName="baseFrequency"
               dur="0.45s" calcMode="discrete"
               values="0.018;0.024;0.020"
               repeatCount="indefinite"/>
    </feTurbulence>
    <feDisplacementMap in="SourceGraphic" in2="noise"
                       scale="3" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>
```

```css
.fx-boil { filter: url(#boil); }   /* apply to a text block, icon, or panel outline */
```
> **Perf**: SVG filters are expensive per pixel. Apply only to *small* elements (a label, a
> number, an SVG stroke), never a full-screen container. `scale="2..4"` is plenty — higher
> looks liquid, not drawn. `numOctaves="1"` keeps it cheap. `calcMode="discrete"` with 3
> values = 3-frame animation. Reduced-motion block above strips `.fx-boil` filter entirely.

**Alt (steps via CSS, swap between 2 pre-baked filters)** if SMIL is undesirable: define
`#boil-a` and `#boil-b` (different `seed`) and toggle a class with `animation: ... steps(2)`
flipping `filter`. But `filter` transitions aren't compositor-cheap — SMIL discrete is better here.

---

## 5. Comic explosion / onomatopoeia "POW!" star burst (score reveal)

Star shape via `clip-path: polygon()`, pop-in via scale/rotate spring.

```html
<div class="pow" style="--accent:var(--agent-4)"><span>POW!</span></div>
```

```css
.pow {
  --accent: var(--amber);
  display: grid; place-items: center;
  aspect-ratio: 1; width: 160px;
  background: var(--accent);
  color: var(--bg-indigo);
  font: 900 2rem/1 system-ui, sans-serif;
  transform: scale(0) rotate(-25deg);
  /* 12-point starburst */
  clip-path: polygon(
    50% 0%, 61% 26%, 89% 15%, 78% 41%, 100% 50%, 78% 59%,
    89% 85%, 61% 74%, 50% 100%, 39% 74%, 11% 85%, 22% 59%,
    0% 50%, 22% 41%, 11% 15%, 39% 26%
  );
}
.pow > span { transform: rotate(-6deg); text-shadow: 2px 2px 0 var(--cream); }

@keyframes pow-in {
  0%   { transform: scale(0)    rotate(-25deg); }
  60%  { transform: scale(1.15) rotate(6deg);  }  /* overshoot */
  80%  { transform: scale(.95)  rotate(-2deg); }
  100% { transform: scale(1)    rotate(0deg);  }
}
.pow.is-reveal { animation: pow-in 480ms cubic-bezier(.34,1.56,.64,1) forwards; will-change: transform; }
```
> `cubic-bezier(.34,1.56,.64,1)` is the "back-out" spring — the elastic comic snap. Border
> ring: add a slightly larger star pseudo-element behind in `--cream` for the double-outline
> sticker look.

---

## 6. Registration-offset flicker (misprint layer jitter)

Emulate cheap 4-color print misregistration: duplicate content in coral + sky, offset each a
touch and jitter on low frames.

```css
.registration { position: relative; color: var(--cream); }
.registration::before, .registration::after {
  content: attr(data-text);
  position: absolute; inset: 0;
  mix-blend-mode: multiply;   /* ink-on-paper feel; use screen on dark bg */
  opacity: .55;
}
.registration::before { color: var(--coral); transform: translate( .5px, .5px); }
.registration::after  { color: var(--sky);   transform: translate(-.5px,-.5px); }

@keyframes reg-flick-a { 0%{transform:translate(.5px,.5px)} 50%{transform:translate(1.5px,-.5px)} 100%{transform:translate(.5px,.5px)} }
@keyframes reg-flick-b { 0%{transform:translate(-.5px,-.5px)} 50%{transform:translate(-1.5px,1px)} 100%{transform:translate(-.5px,-.5px)} }
.registration.is-live::before { animation: reg-flick-a 240ms steps(2) infinite; will-change: transform; }
.registration.is-live::after  { animation: reg-flick-b 300ms steps(2) infinite; will-change: transform; }
```
> Different durations (240 vs 300ms) desync the two layers = authentic drifting misprint.
> `steps(2)` keeps it choppy. Use `mix-blend-mode: screen` over `--bg-indigo`.

---

## 7. Stop-motion low-fps character animation via `steps()` (on-2s / on-3s)

Two techniques: sprite-sheet stepping, or hard-cutting between transform poses.

### 7a. Sprite sheet (N frames in a horizontal strip) — but it's a self-made SVG/CSS strip

```css
/* 6 poses laid out horizontally, container = 1 frame wide */
.sprite {
  width: 96px; height: 96px; overflow: hidden;
}
.sprite > .strip {
  width: 576px;  /* 6 * 96 */
  will-change: transform;
  animation: sprite-run 600ms steps(6) infinite;  /* 10fps → "on-6" comic cadence */
}
@keyframes sprite-run { to { transform: translateX(-576px); } }
```

### 7b. Pose-cut (no sprite): hard-switch between keyframe poses with `steps(1)` per segment

```css
@keyframes bob-on2 {
  0%,49%   { transform: translateY(0)    rotate(-2deg); }
  50%,100% { transform: translateY(-6px) rotate(2deg);  }
}
/* steps(1) inside each half → instant snap, no tween = "animated on 2s" */
.char.is-live {
  animation: bob-on2 500ms steps(1, jump-none) infinite;
  will-change: transform;
}
```
> The trick: put the discontinuity at percentage boundaries and use `steps()` so nothing
> interpolates. 2 poses / 500ms ≈ 4 changes/sec = classic limited animation. For 3-pose
> "on-3" use 3 equal segments (0-33/33-66/66-100) and `steps(1)`.

---

## 8. Kirby Krackle, panel borders, limited-palette flash

### 8a. Kirby Krackle (clustered black energy dots)

Irregular black blobs (not a regular grid). Layer several radial-gradients at random-ish
positions; animate with translate for crackling energy.

```css
.krackle {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(circle at 20% 30%, #000 0 4px, transparent 5px),
    radial-gradient(circle at 65% 20%, #000 0 6px, transparent 7px),
    radial-gradient(circle at 40% 70%, #000 0 3px, transparent 4px),
    radial-gradient(circle at 80% 60%, #000 0 5px, transparent 6px),
    radial-gradient(circle at 15% 85%, #000 0 4px, transparent 5px);
  mix-blend-mode: multiply;
}
@keyframes krackle-buzz {
  0%,100% { transform: translate3d(0,0,0)   scale(1);   }
  33%     { transform: translate3d(1px,-1px,0) scale(1.04); }
  66%     { transform: translate3d(-1px,1px,0) scale(.98); }
}
.krackle.is-live { animation: krackle-buzz 180ms steps(3) infinite; will-change: transform; }
```
> For a denser field, stack a second `.krackle` layer offset. Real Kirby dots often have a
> thin colored halo — add an outer stop in `--violet` before the transparent stop.

### 8b. Comic panel border (thick ink + drop, gutter)

```css
.panel {
  border: 4px solid var(--bg-indigo);
  outline: 3px solid var(--cream);       /* white gutter */
  outline-offset: -1px;
  box-shadow: 6px 6px 0 rgba(0,0,0,.55); /* hard cartoon drop, no blur */
  background: var(--bg-indigo);
}
/* torn/skewed dynamic panel */
.panel--dynamic { transform: rotate(-1.2deg); clip-path: polygon(0 2%,100% 0,99% 100%,1% 98%); }
```

### 8c. Limited-palette flash (score reveal color-slam)

Slam through the token palette on the reveal frame, then settle on the agent accent. Animate
`background-color` is a paint, so for compositor-safety flash an overlay's `opacity` instead,
cycling a CSS var via `steps`.

```css
@keyframes palette-flash {
  0%   { background: var(--coral);  }
  25%  { background: var(--amber);  }
  50%  { background: var(--mint);   }
  75%  { background: var(--sky);    }
  100% { background: var(--agent-1);}   /* land on the agent color */
}
.flash.is-reveal {
  animation: palette-flash 400ms steps(4, jump-none) forwards;
}
/* Compositor-safe alternative: 4 pre-colored overlays, cross-fade opacity */
.flash-overlay { position:absolute; inset:0; opacity:0; }
.flash-overlay.is-live { animation: flash-op 100ms steps(1) 4; will-change: opacity; }
@keyframes flash-op { 0%{opacity:1} 100%{opacity:0} }
```
> `steps(4)` = 4 hard color slams (no gradient blend) = str16-color-print vibe. If flashing
> `background` on a large area hurts, use the overlay-opacity variant.

---

## Caveats / Not Found

- **SVG filter cost is real**: recipes 4 (boil) and any full-screen `filter: url()` can drop
  frames on low-end mobile. Rule: filter only text/small nodes; test with DevTools "Paint
  flashing" + FPS meter. If a full-panel boil is required, pre-render to a short `<video>`/APNG
  is the escape hatch — but that violates the "no baked assets" constraint, so keep filters small.
- **`mix-blend-mode` forces a stacking context / can disable some GPU fast-paths** on Safari;
  verify halftone/registration overlays don't cause repaint storms when combined with the
  animated transform layers. Isolate with `isolation: isolate` on the parent.
- **`steps()` + `jump-none` / `jump-both`** support is universal in evergreen browsers; if you
  must support old Safari, fall back to plain `steps(n)` (defaults to `jump-end`).
- **conic-gradient speed-lines** rotate cheaply, but a *repeating*-conic-gradient repaint on
  `background` change is costly — only ever animate it via `transform`, never by changing the
  gradient angle in the `background` property. The recipe above already does this correctly.
- Did not benchmark on actual hardware; all "perf" notes are from the compositor model
  (transform/opacity = composite-only; filter/background = paint). Validate in target browsers.
