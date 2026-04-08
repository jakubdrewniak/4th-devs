# autoprompt

Automated prompt optimization loop. Give it a seed prompt, test cases with expected outputs, and a JSON schema — it iteratively improves the prompt by generating candidate changes, evaluating them with an LLM judge, and keeping only what beats the current best.

Inspired by [autoresearch](https://github.com/karpathy/autoresearch): same hill-climbing loop, but applied to prompts instead of training code.

## How it works

```
seed prompt
    │
    ▼
┌─────────────────────────────────────┐
│  BASELINE: run prompt on test cases │
│  judge scores extraction vs expected│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  ITERATION (repeat N times)        │
│                                     │
│  1. Generate K candidate prompts    │
│     (parallel, different strategies)│
│                                     │
│  2. Evaluate all candidates         │
│     (extraction + LLM judge)        │
│                                     │
│  3. Pick best candidate             │
│     if it beats current best → keep │
│     otherwise → discard             │
│                                     │
│  4. Feed result into next iteration │
│     (history, section deltas)       │
└─────────────────────────────────────┘
               │
               ▼
        best prompt saved
```

Each iteration generates multiple candidates with different strategy hints (balanced, coverage, simplify, boundary, salience), evaluates all of them, and keeps the single best if it improves the score. History of previous attempts — including per-section score deltas and reasoning — feeds back into the next round so the improver avoids repeating failed approaches.

## Quick start

```bash
# optimize the demo project (uses cases 01, 02 for training)
npm run demo:optimize

# verify the result on holdout case 03
npm run demo:verify
```

## Project structure

```
src/
  cli/              optimize.js, verify.js — CLI entrypoints
  core/             optimize-project.js, run-evaluation.js, improve-prompt.js,
                    score-batch.js, prompt-diff.js, format-evaluation-policy.js
  prompts/          improver-system.js, judge-system.js — internal system prompts
  llm/              complete.js — LLM transport, trace.js — call logging
  project/          load-project.js, validate-project.js
  run-artifacts/    write-optimize-run.js — saves results, diffs, traces
  config/           defaults.js

projects/<name>/    user-owned project inputs
  autoprompt.config.js
  prompt.initial.md
  schema.js
  test-data/
    input_XX.md
    expected_XX.json
    context_XX.json  (optional prior state)

runs/<name>/<ts>/   generated outputs per optimization run
  results.tsv
  run.json
  prompt.initial.md
  prompt.best.md
  diffs/
  traces/
```

## Creating a project

A project needs four things:

**1. `autoprompt.config.js`** — defines everything:

```js
export default {
  name: "my-project",
  prompt: "./prompt.initial.md",
  schema: "./schema.js",
  testsDir: "./test-data",
  models: {
    execution: { model: "gpt-5.4-mini", reasoning: { effort: "none" } },
    judge:     { model: "gpt-5.4",      reasoning: { effort: "high" } },
    improver:  { model: "gpt-5.4",      reasoning: { effort: "high" } },
  },
  optimization: {
    candidates: 3,
    cases: ["01", "02"],
    verifyCases: ["03"],
  },
  evaluation: {
    sections: [
      {
        key: "tasks",
        weight: 0.5,
        matchBy: ["task"],
        fields: { task: "semantic", status: "exact", assignee: "exact" },
      },
      // ... more sections
    ],
  },
};
```

**2. `prompt.initial.md`** — the seed prompt. Can be minimal:

```markdown
You are a data extractor.

<objective>
Extract structured data from the input as JSON matching the provided schema.
</objective>

<rules>
- Extract only what is explicitly stated.
</rules>
```

**3. `schema.js`** — the output JSON schema (enforced via API):

```js
export default {
  name: "my_output",
  schema: {
    type: "object",
    properties: { /* ... */ },
    required: [ /* ... */ ],
  },
};
```

**4. `test-data/`** — labeled test cases:

```
test-data/
  input_01.md          transcript / input text
  expected_01.json     ground truth output
  context_01.json      optional prior state
  input_02.md
  expected_02.json
  ...
```

Then run:

```bash
node src/cli/optimize.js projects/my-project
node src/cli/verify.js projects/my-project
```

## Configuration reference

### `optimization`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `candidates` | number | 3 | Candidate prompts generated per iteration |
| `cases` | string[] | all | Test case IDs used during optimization |
| `verifyCases` | string[] | all | Test case IDs used during verify |

### `evaluation.sections[]`

| Key | Type | Description |
|-----|------|-------------|
| `key` | string | Must match a root array in the schema |
| `weight` | number | Scoring weight (all weights must sum to 1) |
| `matchBy` | string[] | Fields used to match actual items to expected items |
| `fields` | object | Each field is `"exact"` or `"semantic"` |

### `models`

Three roles: `execution` (runs the prompt), `judge` (scores outputs), `improver` (suggests prompt changes). Each has `model` (string) and optional `reasoning: { effort }`.

## CLI flags

```bash
node src/cli/optimize.js <project-dir> [--iterations N] [--runs N]
node src/cli/verify.js <project-dir> [--prompt path/to/prompt.md]
```

## Run artifacts

After optimization, `runs/<project>/<timestamp>/` contains:

| File | Content |
|------|---------|
| `results.tsv` | Score, status, operation, section changes per iteration |
| `run.json` | Models used, baseline/best scores, settings |
| `prompt.initial.md` | Starting prompt |
| `prompt.best.md` | Best prompt found |
| `diffs/*.diff` | Per-iteration diff with reasoning, candidate scoreboard |
| `traces/*.json` | Raw LLM API request/response for every call (extraction, judge, improver) |

## Design choices

**LLM-as-judge over deterministic scoring.** String matching penalizes valid paraphrases. The LLM judge understands that "Build core agent loop" and "Build the core agent loop with tool calling" are the same task.

**Best-of-N candidates per iteration.** Each round generates multiple prompt variants with different strategy hints (add coverage, simplify, sharpen boundaries). Evaluates all, keeps the best. Roughly triples the keep rate compared to single-candidate search.

**Train/verify split.** Optimization cases and holdout cases are configured separately in the project config. The optimizer never sees verify cases. This prevents overfitting to the training set.

**Structured prompt format.** The improver is constrained to produce prompts in a fixed XML-section format (role, objective, context, rules). Each rule is one bullet point. This prevents wall-of-text collapse and makes diffs meaningful.

**Full API tracing.** Every LLM call (extraction, judge, improver) is logged with request, response, and timing. Saved per-stage in the traces folder for debugging.
