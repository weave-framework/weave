# Performance

Weave has no Virtual DOM and no dependency arrays. A template compiles straight to
real DOM operations bound to signals, so when a value changes Weave updates *only* the
nodes that read it — there is no tree to diff and no component to re-run. This page
puts a number on that with a reproducible benchmark you can run yourself.

## How we measure

Comparing raw milliseconds across machines is meaningless, and a framework's own
"we win" chart is worth little. So the benchmark measures the one figure that travels:
the **slowdown factor over a hand-written vanilla-DOM baseline on the same machine**.
That is exactly how the independent
[js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/current.html)
normalises every framework, so Weave's ratio can be lined up against its published
results.

The harness lives in [`benchmarks/`](https://github.com/weave-framework/weave/tree/main/benchmarks)
and runs the standard row operations — create 1k and 10k rows, update every 10th row,
swap, select, remove, clear — in both vanilla DOM and idiomatic Weave (`@for` over a
keyed signal), each as the median of many reps with warmup discarded.

```bash
node benchmarks/bench.mjs
```

## Results

:::callout note "Run it on your own hardware"
These are one representative run — headless Chromium, Windows 11, 2026-07-04. Absolute
times depend on the machine; the **ratio** is the portable part. Sub-millisecond
operations (like *select*) fall below the timer's resolution, so their ratio is left
out rather than reported as noise.
:::

| Operation | vanilla | Weave | slowdown |
| --- | --: | --: | --: |
| create 1,000 rows | 16.3 ms | 20.5 ms | 1.26× |
| create 10,000 rows | 173.8 ms | 242.8 ms | 1.40× |
| update every 10th (1k) | 5.3 ms | 5.1 ms | **0.97×** |
| swap 2 rows (1k) | 1.0 ms | 1.4 ms | 1.40× |
| select a row (1k) | ~0 ms | 0.7 ms | — |
| remove a row (1k) | 0.9 ms | 1.4 ms | 1.50× |
| clear 1,000 rows | 1.2 ms | 2.6 ms | 2.22× |
| **geometric mean** | | | **≈1.4×** |

## What the numbers say

- **≈1.4× vanilla overall.** On the public benchmark that range is where the fast keyed
  frameworks live — between Solid (closest to vanilla) and React. Weave is right in
  that group while shipping a runtime with zero third-party dependencies.
- **Targeted updates are essentially free.** *Update every 10th row* comes in at ~1×
  vanilla: Weave re-runs only the text bindings of the rows that changed. With no diff
  step, a precise mutation costs about what the direct DOM write costs — this is the
  whole point of fine-grained reactivity.
- **Automatic cleanup has a small, honest cost.** *Clear* is ~2× because Weave disposes
  each row's reactive scope as the node is removed, so effects never leak. On a thousand
  rows that is a couple of milliseconds.

## For an apples-to-apples cross-framework table

We deliberately don't publish our own React/Solid runs here — doing that fairly (matched
versions, tuning, throttling) is a whole discipline, and an independent source is more
trustworthy than a framework grading its own homework. For current cross-framework
figures, see the live
[js-framework-benchmark results](https://krausest.github.io/js-framework-benchmark/current.html),
then compare Weave's ~1.4× vanilla ratio against them.
