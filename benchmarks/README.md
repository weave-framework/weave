# Weave benchmarks

A small, honest performance harness. It runs the standard
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) row
operations three times — in hand-written **vanilla DOM** (the baseline), in idiomatic
**Weave** (`@for` over a keyed signal with a bare `<tr>` row), and in Weave with a
**component per row** (`<Row r={{ r }} />` inside the `@for`, which is what applications
write) — and reports each Weave column's **slowdown factor over vanilla on the same machine**.

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
node benchmarks/profile.mjs        # where the time goes, per function (see below)
```

It bundles `harness.js` with esbuild and runs it in headless Chromium via Playwright
(already a dev dependency). Each operation is the median of many reps against a fresh
mount per rep, with warmup runs discarded and a forced layout inside the clock so real
reflow cost is counted.

**The ratio is taken per suite, then the median of those ratios** — not the ratio of two
medians. The three implementations run back to back inside one suite, so a machine that
is slower during suite 3 (thermal state, a background process) slows all three together
and the per-suite ratio stays put. The ratio of medians taken across suites did not: two
consecutive runs of this file disagreed by 30% on the same code. Individual rows still
move ±20% between runs on a laptop; read the geometric mean and look for movement that
repeats.

## Why a component column

The bare `<tr>` row is the public benchmark's shape, and it is not what a Weave app
writes: a real list puts a component in the row. That row is then a fragment bracketed
by marker comments, `defineComponent` builds a props object and a context over it per
instance, and the child's bindings read props through that prototype chain. None of it
was measured until the column existed — and it measured **1.6×** where the bare row
measured **1.26×**. An optimization can no longer win on the bare row and lose unseen
on the real one.

## Where the time goes: `profile.mjs`

`bench.mjs` says *how much* slower an operation is; `profile.mjs` says *which functions*
the time is in. It runs one operation of one implementation under Chromium's sampling
profiler (CDP `Profiler`, 100 µs interval) and prints self time per function:

```bash
node benchmarks/profile.mjs                       # component rows, create 10,000
node benchmarks/profile.mjs create10k weave       # bare rows
node benchmarks/profile.mjs clear component 40    # another op, 40 repetitions
```

Its first run found the harness itself at fault: function-mode compiler output ends in
`return render(ctx, {})`, so a component rendered once per row re-parsed its template
10,000 times — 13.8% of the column's self time that no shipped app pays (a built module
hoists the parse). `harness.js` now hoists it the same way. **A probe must pay what the
real build pays, or it measures a different program.**

The same profile, after the fix, on a 10,000-row create with a component per row:
layout (`offsetHeight` inside the clock) ~60%, GC ~5%, `insertBefore` ~5%, `cloneNode`
~3%, and the reactive core — `track`, `effect`, `dispose` together — about 2%. That is
why a rewrite of the core's `Set`-based graph to arrays, which was on the list, was not
done: the measurement does not point there.

## What it measures

The seven standard operations: create 1,000 and 10,000 rows, update every 10th row,
swap two rows, select a row, remove a row, and clear the table.

## A representative run

Headless Chromium (Playwright), Windows 11, 2026-10-27, after the row-emit changes of
this date (placeholder text nodes instead of comment anchors for a sole interpolation,
`firstChild`/`nextSibling` chains instead of `child()` calls, prototype row accessors, a
one-`Range` list clear). **Your numbers will differ** — run it yourself. Sub-millisecond
operations (e.g. *select*, which toggles a class) sit below the timer's useful
resolution, so their ratio is omitted rather than reported as noise.

| Operation | vanilla ms | weave ms | slowdown | component ms | slowdown |
| --- | --: | --: | --: | --: | --: |
| create 1,000 rows | 29.85 | 29.00 | 1.02× | 33.75 | 1.13× |
| create 10,000 rows | 338.35 | 320.50 | 1.07× | 563.20 | 1.81× |
| update every 10th (1k) | 10.50 | 8.10 | 0.81× | 8.30 | 0.84× |
| swap 2 rows (1k) | 2.00 | 2.55 | 1.38× | 2.50 | 1.32× |
| select a row (1k) | ~0 | 0.90 | — | 1.25 | — |
| remove a row (1k) | 1.65 | 2.70 | 1.26× | 2.00 | 1.21× |
| clear 1,000 rows | 2.15 | 3.80 | 1.95× | 5.15 | 2.70× |
| **geometric mean (rated ops)** | | | **1.20×** | | **1.40×** |

The same harness on the code from before those changes, run minutes earlier on the same
machine: **1.26×** bare and **1.63×** component, with `clear` at 2.44× and 3.80×.

## How to read it

- **~1.2× vanilla for bare rows, ~1.4× with a component per row.** That lands Weave
  among the fast keyed frameworks on the public benchmark, where the mainstream
  libraries sit roughly between Solid (nearest vanilla) and React.
- **Fine-grained updates are the standout.** *update every 10th* is at or under 1×
  vanilla: Weave re-runs only the text bindings of the changed rows — there is no tree
  to diff, so a targeted mutation costs what the direct DOM write costs.
- **Teardown carries a constant cost.** *clear* is ~2× because Weave disposes each
  row's reactive scope (its effects) as the rows go — the price of automatic cleanup.
  The DOM removal itself is now one `Range.deleteContents()`; what remains is the
  disposal. It is a few milliseconds on a thousand rows.
- **Caveats.** Single machine, headless, no CPU throttling; medians hide tail latency;
  micro-ops are noisy. Treat these as ballpark, not leaderboard. The methodology (a
  per-suite vanilla ratio) is the point — re-run on your hardware.
