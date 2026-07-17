# Research: LLM-as-a-Judge Best Practices for Rubric-Based Homework Grading

- **Query**: Best practices for using LLMs to score student homework against a key-point rubric derived from lecture notes; prompt design, bias reduction, key-point coverage scoring, multi-model ensemble aggregation, academic frameworks.
- **Scope**: External (methodology / prompt-engineering knowledge, synthesized from LLM-eval literature — G-Eval, LLM-as-judge bias studies, rubric-based eval). No web fetch available in this env; content is from model knowledge through early 2026. Treat version-specific claims as needing verification.
- **Date**: 2026-07-17

---

## TL;DR — The Core Mechanism That Matters

The single most important design decision: **do not ask the model for a holistic score**. Holistic scoring is where all the bias and variance lives.

Instead, **decompose grading into a checklist of atomic, pre-extracted key points, judge each one independently as a binary/ternary label, then compute the score deterministically in code** (not by the LLM). The LLM's only job is per-key-point coverage classification with evidence; arithmetic is done by your backend. This one move eliminates most leniency drift, makes scores reproducible, and gives you an auditable trail.

Everything below elaborates this and the supporting techniques.

---

## 1. Grading Prompt Design (reliability, consistency, low bias)

### 1.1 Separate the two phases — extraction vs. judging

Run grading as **two distinct LLM calls** (or two clearly separated stages), never one:

1. **Rubric extraction** (once per assignment, cached): from the lecture notes / reference answer, extract a flat list of *atomic key points*. An atomic key point = one checkable factual/conceptual claim, expressible in one sentence, independently verifiable. Split compound statements ("X because Y") into two. Assign each a stable `id` and a `weight`.
2. **Answer judging** (once per student, or once per student per model): given the fixed key-point list + the student answer, classify each key point's coverage. The judge never invents key points and never re-weights them.

Why: separating extraction from judging means the rubric is *identical* across all students and all grader models — the comparison is apples-to-apples, and you can human-review/edit the rubric once instead of trusting the model to re-derive it every time.

### 1.2 Per-key-point ternary classification (not a global score)

For each key point, the judge outputs one label:

- `covered` — student clearly states/demonstrates this point (correctly).
- `partial` — mentioned but incomplete, imprecise, or partially wrong.
- `missing` — absent, or stated incorrectly.

Ternary beats binary here because student answers are rarely all-or-nothing, and it gives you a knob (partial = 0.5 weight) without asking the model to emit fractional scores (which it does inconsistently).

### 1.3 Force evidence BEFORE the label (grounded CoT)

For each key point, require the model to **quote the specific span of the student answer** that supports the label *before* it emits the label. Order matters: evidence first, reasoning second, label last. This is the anti-hallucination lever (see §2.4). If the model cannot produce a supporting quote, the label must be `missing`.

Structure per key point:
```
{
  "id": "kp_03",
  "student_evidence": "<verbatim quote from student answer, or empty string>",
  "reasoning": "<1-2 sentences: does the evidence satisfy the key point?>",
  "label": "covered" | "partial" | "missing"
}
```

The `student_evidence` MUST be a verbatim substring of the submission. Validate this in code — reject/re-ask if the quote isn't actually present (catches fabricated evidence).

### 1.4 Chain-of-thought, but bounded and structured

Free-form CoT before scoring improves reliability (this is the G-Eval finding), but unbounded CoT invites verbosity bias and rambling. Constrain it: reasoning is *per key point*, capped to 1–2 sentences, and framed as a coverage question ("Does the quoted evidence establish key point X?"), not an open-ended critique. Do not let the model write a global essay about answer quality.

### 1.5 Structured output — enforce a schema

Always request strict JSON matching a schema, and validate on receipt.

- Use the provider's structured-output / JSON-mode / tool-calling mechanism where available (OpenAI structured outputs, function calling; for DeepSeek/Doubao use JSON mode + strict post-validation since schema enforcement is weaker).
- Give an explicit output schema in the prompt AND validate server-side. Reject and retry (max 1–2 retries) on: invalid JSON, missing key-point ids, evidence not a substring, unknown labels.
- Never let the model return the final numeric grade. Score = deterministic function of the labels + weights, computed in your code.

### 1.6 Deterministic scoring formula (in code, not in the model)

```
raw = Σ_i weight_i * f(label_i)      where f(covered)=1, f(partial)=0.5, f(missing)=0
score = round( 100 * raw / Σ_i weight_i )
```

Because this is code, the same labels always yield the same score — full reproducibility, and you can change the partial-credit policy without re-running the LLM.

### 1.7 Decoding / sampling settings

- **temperature = 0** (or lowest available) for judging. You want determinism, not creativity.
- Fix `seed` if the provider supports it (OpenAI does; helps but doesn't guarantee determinism).
- Keep the prompt, rubric ordering, and system message byte-stable across runs so caching and reproducibility hold.

### 1.8 Anchored labels with mini-definitions

In the prompt, define each label with a crisp decision rule and ideally 1 short in-context example (a "covered" example and a "partial" example). Anchoring the scale with concrete exemplars is the strongest single reducer of severity/leniency drift across models. Keep examples short to avoid blowing context and to avoid verbosity bias.

---

## 2. Reducing Common LLM-Grader Failure Modes

| Failure mode | What it looks like here | Mitigation |
|---|---|---|
| **Leniency / severity bias** | Model systematically over- or under-credits; different models grade the same answer differently | Ternary per-point labels + code-computed score (removes global scale drift); anchored label definitions with exemplars (§1.8); calibrate per model with a small gold set (§2.5); ensemble across models (§4) |
| **Position bias** | Key points listed first get more attention/credit than later ones; or in pairwise setups the first option wins | Grade against an *absolute* rubric, not pairwise, so there's no A/B position to bias. Randomize/rotate key-point order across runs if you see order effects. Keep the key-point list short enough to fit comfortably in context |
| **Verbosity bias** | Longer, more elaborate student answers get higher scores regardless of correctness | Coverage-based scoring is inherently length-robust: a point is covered or not, padding earns nothing. Explicitly instruct: "Length, fluency, and confidence of the answer are irrelevant; judge only whether each key point is factually present." Do not ask about "quality/effort" |
| **Hallucinated coverage** | Model claims a point is covered when the student never said it (sycophancy / pattern-completion) | Require verbatim `student_evidence` quote before the label (§1.3); validate the quote is a real substring in code; if no quote → force `missing`. This is the highest-leverage fix |
| **Self-enhancement / familiarity bias** | Model favors answers phrased like its own outputs | Ternary evidence-grounded labels reduce it; ensemble across different model families (§4) dilutes any single model's stylistic preference |
| **Rubric drift** | Model silently invents, merges, or drops key points | Extraction is a separate cached stage (§1.1); judging prompt says "you MUST return a label for exactly these N ids and no others"; validate id set in code |
| **Format / parse failures** | Broken JSON, extra prose | Structured output + schema validation + bounded retries (§1.5) |
| **Overconfidence on partial** | Everything labeled covered or missing, `partial` never used | Give a concrete `partial` exemplar; in reasoning ask "is the evidence complete AND correct?" — if complete-but-imprecise or correct-but-incomplete → partial |

### 2.5 Calibration against a gold set

Hand-grade ~20–50 answers to build a gold set. For each grader model, measure:
- Agreement with humans (Cohen's / Krippendorff's kappa, or QWK — quadratic weighted kappa — for ordinal scores).
- Systematic bias (mean signed error: is the model +8 points lenient?).

Then apply a per-model linear calibration (offset/scale) or just use the gold set to pick label thresholds and exemplars. Re-run whenever you change models or model versions. This is cheap and catches leniency drift that prompt tuning alone won't.

---

## 3. Key-Point / Rubric-Coverage Scoring Pattern (concrete pipeline)

This is the recommended end-to-end flow the grading agents should implement.

```
Stage A — Rubric extraction (per assignment, cached, ideally human-reviewed)
  input:  lecture notes / reference answer + (optional) question
  output: [ { id, text (atomic key point), weight }, ... ]
  prompt rules:
    - "Extract atomic key points a correct answer must contain."
    - "One idea per point. Split compound claims. No overlap between points."
    - "Assign integer weight 1-5 by importance; default 1."
    - "Do not include stylistic or formatting requirements unless the question demands them."

Stage B — Coverage judging (per student answer, per grader model)
  input:  fixed key-point list + student answer
  output: [ { id, student_evidence, reasoning, label }, ... ]
  rules:  §1.3 evidence-first, ternary labels, verbatim quote required

Stage C — Score aggregation (deterministic code)
  - validate: JSON ok, all/only expected ids present, evidence is substring
  - compute score via weighted formula (§1.6)
  - emit: numeric score + per-point breakdown + list of missing/partial points
          (the missing/partial list IS the actionable feedback to the student)
```

Key design notes:
- **Atomicity is everything.** If key points are compound, the `partial` label becomes noisy and evidence quoting breaks down. Invest in Stage A quality; review it once by hand per assignment — it's reused for every student.
- **The missing-points list is a feedback feature, not a byproduct.** It tells the student exactly what to add. Surface it.
- **Weights let you match the official mark scheme.** Map lecture-note emphasis → weights so the computed score tracks the human rubric.
- **Handle "correct but not in notes."** Coverage-only grading punishes valid answers the notes didn't anticipate. Add an optional Stage B side-question: "List any statements in the answer that are correct and relevant but NOT among the key points." Route those to human review or a small bonus policy — don't let the rubric cap penalize genuinely good answers.
- **Handle contradictions.** A point can be "covered" verbatim yet contradicted elsewhere. The `reasoning` step should check correctness, not just presence; a stated-but-wrong point is `missing`/`partial`, not `covered`.

---

## 4. Multi-Model Ensemble Grading (OpenAI / DeepSeek / Doubao)

Ensembling reduces any single model's systematic bias and flags low-confidence cases. Because scoring is decomposed into per-key-point labels, aggregate **at the label level**, not at the final-score level — this is more robust and more interpretable.

### 4.1 Aggregate per key point (recommended)

For each key point, collect the label from each model and combine:

- **Majority vote** on the ternary label per key point (map covered=1, partial=0.5, missing=0; take median or mode). Median of {covered, partial, missing} → partial, which is a sensible conservative default.
- **Disagreement flag**: if models split (e.g. one `covered`, one `missing`), mark the key point `uncertain` and route to human review. Model disagreement is your best cheap signal for "this one needs a human."
- Then run the deterministic score formula on the aggregated labels.

This gives one auditable consensus rubric per student plus a targeted human-review queue.

### 4.2 Aggregation policies (pick per goal)

| Policy | How | When to use |
|---|---|---|
| **Average** (score-level) | mean of each model's computed score | Simple central tendency; smooths idiosyncratic leniency. Use trimmed mean or median if one model is an outlier |
| **Majority** (label-level) | per-key-point mode/median across models | Default for reliability; interpretable |
| **Intersection of covered** (strict) | a point counts as covered only if ALL models agree covered | High-stakes / anti-inflation grading; conservative, lowers scores, minimizes false "covered" |
| **Union of missing** (strict feedback) | a point is flagged missing if ANY model says missing | Generating maximal actionable feedback; over-reports gaps, good for formative feedback drafts |
| **Weighted by model reliability** | weight each model's vote by its gold-set kappa (§2.5) | When you know one model grades this subject better |

Practical default: **label-level median for the score, union-of-missing for feedback, disagreement→human-review.** Conservative score, thorough feedback, safe escalation.

### 4.3 Operational notes

- Normalize outputs first: all models must emit the same schema & id set before aggregation. Doubao/DeepSeek JSON adherence is weaker than OpenAI's — validate and retry per model, and drop a model's vote for a given student if it never returns valid output (don't let a parse failure silently skew the mean).
- Keep the identical rubric + prompt across models; only the model endpoint changes. Otherwise you're aggregating apples and oranges.
- Cost/latency: run the models in parallel. For a cheap tier, use single-model grading and only trigger the full ensemble when the single model's per-point confidence is low or the score is near a grade boundary (e.g. pass/fail cutoff).
- **Don't self-ensemble a model as its own judge of its own grading** — no self-consistency-as-verification illusion; use different families for genuine bias diversity.

---

## 5. Relevant Academic / Well-Known Frameworks

- **G-Eval** (Liu et al., 2023) — LLM-as-judge with (a) an auto-generated chain-of-thought "evaluation steps" from the rubric, then (b) form-filling scoring, and (c) score smoothing by taking a probability-weighted average of score tokens to reduce ties/coarseness. Takeaways for us: generate explicit evaluation steps from the rubric before scoring; use CoT before the number. The probability-weighting trick is less relevant since we score in code from labels.
- **Rubric-based / checklist evaluation** (widely adopted; e.g. checklist-style grading, "FLASK"-style fine-grained skill decomposition, HealthBench-style rubric criteria) — decompose the target into many fine-grained criteria and judge each independently. This is exactly the §3 key-point pattern and is the current best-practice consensus for reliable LLM grading.
- **LLM-as-a-judge bias literature** (e.g. Zheng et al., "Judging LLM-as-a-Judge" / MT-Bench & Chatbot Arena work) — documents position bias, verbosity bias, and self-enhancement bias, and recommends: swapping positions (pairwise), reference-guided grading, and few-shot anchoring. We avoid position/pairwise bias entirely by using absolute rubric grading.
- **Reference-guided grading** — always give the judge the reference answer / key points rather than asking it to grade from its own priors. This is core to our design and is the biggest accuracy lever after decomposition.
- **Agreement metrics** — use **Quadratic Weighted Kappa (QWK)** for ordinal score agreement with humans (standard in automated essay/short-answer scoring), and Krippendorff's alpha for inter-model reliability. Report these on the gold set to justify the pipeline.
- **Constitutional / rubric-in-prompt anchoring** — putting explicit, exemplar-anchored criteria in the prompt reduces scale drift; standard practice.

---

## 6. Concrete Prompt Skeletons to Bake In

### 6.1 Rubric extraction (Stage A) — system + user

System: "You extract grading rubrics. You output only atomic key points a correct answer must contain. One idea per point. Split compound claims. No stylistic requirements. Output strict JSON."

User: `{question, lecture_notes_or_reference}` → expect:
```json
{ "key_points": [ { "id": "kp_1", "text": "...", "weight": 2 } ] }
```

### 6.2 Coverage judging (Stage B) — system + user

System (the important one):
```
You are a strict, evidence-based grader. For EACH provided key point, decide
whether the student's answer covers it. Rules:
- You MUST return a result for exactly these key-point ids and no others.
- Before labeling, quote the VERBATIM span of the student answer that supports
  the point in "student_evidence". If no such span exists, set it to "" and the
  label MUST be "missing".
- A point that is stated but incorrect or contradicted is "missing" or "partial",
  never "covered".
- Judge ONLY factual/conceptual presence and correctness. IGNORE length, fluency,
  confidence, and writing style.
- Keep reasoning to one or two sentences per point.
- Output strict JSON only.
```

User: `{ key_points: [...], student_answer: "..." }` → expect:
```json
{ "results": [
  { "id": "kp_1", "student_evidence": "...", "reasoning": "...", "label": "covered" }
] }
```

### 6.3 Server-side validation checklist (code, before scoring)
- [ ] Valid JSON parse (else retry ≤2).
- [ ] `results` ids == rubric ids exactly (no missing, no extra).
- [ ] Every `label` ∈ {covered, partial, missing}.
- [ ] For non-missing labels, `student_evidence` is a non-empty verbatim substring of the submission → else downgrade to `missing` or retry.
- [ ] Compute score in code via weighted formula; never trust a model-emitted number.

---

## Caveats / Not Found

- **No live web search available in this environment** — I could not fetch current (2026) papers or provider docs to cite URLs/versions. Framework names (G-Eval, MT-Bench, FLASK, HealthBench) and bias taxonomy are from model knowledge and are well-established, but confirm exact citations before quoting in a paper/report.
- **Provider-specific structured-output capabilities change fast.** Verify current JSON-mode / structured-output / seed support for OpenAI, DeepSeek, and Doubao at implementation time; DeepSeek/Doubao schema enforcement is historically weaker — budget for validation + retries.
- **Partial-credit weight (0.5) is a policy choice**, not a law — tune it against your gold set to match the official mark scheme.
- Calibration numbers (20–50 gold answers, ±kappa targets) are rules of thumb; adjust to your assignment volume and stakes.
