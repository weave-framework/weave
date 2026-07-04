# Weave benchmarks

A small, honest performance harness. It runs the standard
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) row
operations twice — once in hand-written **vanilla DOM** (the baseline) and once in
idiomatic **Weave** (`@for` over a keyed signal) — and reports Weave's **slowdown
factor over vanilla on the same machine**.

## Why a vanilla baseline (and not "Weave vs React" numbers here)

Absolute milliseconds are machine-specific and not comparable across setups. What
*is* comparable is the ratio to a vanilla-JS implementation, because the public
js-framework-benchmark normalises every framework the same way. So this harness
measures the one number that can be lined up against those published results:
`weave ÷ vanilla`. We deliberately do **not** ship our own React/Solid runs — doing
that credibly (same versions, same tuning, warm vs cold, CPU throttling) is a project
in itself, and a self-run "we win" table is worth less than an independent one. For
their figures, see the live [js-framework-benchmark results](https://krausest.github.io/js-framework-benchmark/current.html).

## Run it

```bash
node benchmarks/bench.mjs          # human-readable table
node benchmarks/bench.mjs --json   # machine-readable
```

It bundles `harness.js` with esbuild and runs it in headless Chromium via Playwright
(already a dev dependency). Each operation is the median of many reps across several
suite repeats, against a fresh mount per rep, with warmup runs discarded and a forced
layout inside the clock so real reflow cost is counted.

## What it measures

The seven standard operations: create 1,000 and 10,000 rows, update every 10th row,
swap two rows, select a row, remove a row, and clear the table.

## A representative run

Headless Chromium (Playwright), Windows 11, 2026-07-04. **Your numbers will differ** —
run it yourself. Sub-millisecond operations (e.g. *select*, which toggles a class) sit
below the timer's useful resolution, so their ratio is omitted rather than reported as
noise.

| Operation | vanilla ms | weave ms | slowdown |
| --- | --: | --: | --: |
| create 1,000 rows | 16.25 | 20.50 | 1.26× |
| create 10,000 rows | 173.75 | 242.80 | 1.40× |
| update every 10th (1k) | 5.25 | 5.10 | **0.97×** |
| swap 2 rows (1k) | 1.00 | 1.40 | 1.40× |
| select a row (1k) | ~0 | 0.70 | — |
| remove a row (1k) | 0.90 | 1.35 | 1.50× |
| clear 1,000 rows | 1.15 | 2.55 | 2.22× |
| **geometric mean (rated ops)** | | | **≈1.4×** |

## How to read it

- **~1.4× vanilla, weighted geometric mean.** That lands Weave among the fast keyed
  frameworks on the public benchmark, where the mainstream libraries sit roughly
  between Solid (nearest vanilla) and React.
- **Fine-grained updates are the standout.** *update every 10th* is ~1× vanilla:
  Weave re-runs only the text bindings of the changed rows — there is no tree to diff,
  so a targeted mutation costs almost exactly what the direct DOM write costs.
- **Teardown carries a constant cost.** *clear* is ~2× because Weave disposes each
  row's reactive scope (its effects) as it removes the node — the price of automatic
  cleanup. It is a few milliseconds on a thousand rows.
- **Caveats.** Single machine, headless, no CPU throttling; medians hide tail latency;
  micro-ops are noisy. Treat these as ballpark, not leaderboard. The methodology (a
  vanilla ratio) is the point — re-run on your hardware.
