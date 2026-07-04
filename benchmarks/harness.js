/**
 * In-page benchmark body (bundled + run by `bench.mjs`). Implements the standard
 * js-framework-benchmark row operations twice — once in hand-written vanilla DOM
 * (the baseline) and once in idiomatic Weave (`@for` over a keyed signal) — so each
 * Weave timing can be expressed as a slowdown factor over vanilla ON THE SAME
 * MACHINE. That factor is what the public js-framework-benchmark reports, so it is
 * the only figure that is fair to compare across machines.
 *
 * We measure the synchronous DOM work: mutate state, force layout (`offsetHeight`),
 * stop the clock. Weave flushes its effects synchronously inside `signal.set`, and
 * the vanilla version writes the DOM directly, so both include the real layout cost.
 */
import { signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

/* ---------- shared data ---------- */
const ADJ = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const COLOUR = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const NOUN = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

let nextId = 1;
// A tiny deterministic LCG so runs are reproducible (no Math.random variance).
let seed = 123456789;
function rnd(n) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}
function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = { id: nextId++, label: `${ADJ[rnd(ADJ.length)]} ${COLOUR[rnd(COLOUR.length)]} ${NOUN[rnd(NOUN.length)]}` };
  }
  return data;
}

/* ---------- vanilla baseline ---------- */
function vanillaImpl(root) {
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  root.appendChild(table);
  let rows = [];
  let selected = null;

  const makeRow = (item) => {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = String(item.id);
    const td2 = document.createElement('td');
    const a = document.createElement('a');
    a.textContent = item.label;
    td2.appendChild(a);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr._item = item;
    tr._label = a;
    return tr;
  };

  return {
    create(data) {
      tbody.textContent = '';
      rows = data.map(makeRow);
      const frag = document.createDocumentFragment();
      for (const tr of rows) frag.appendChild(tr);
      tbody.appendChild(frag);
    },
    updateEvery10th() {
      for (let i = 0; i < rows.length; i += 10) {
        rows[i]._item.label += ' !!!';
        rows[i]._label.textContent = rows[i]._item.label;
      }
    },
    swap() {
      if (rows.length < 999) return;
      const a = rows[1], b = rows[998];
      const an = a.nextSibling;
      tbody.insertBefore(b, an);
      tbody.insertBefore(a, rows[999]);
      rows[1] = b; rows[998] = a;
    },
    select() {
      if (selected) selected.classList.remove('danger');
      selected = rows[1];
      if (selected) selected.classList.add('danger');
    },
    remove() {
      const tr = rows.splice(1, 1)[0];
      if (tr) tbody.removeChild(tr);
    },
    clear() {
      tbody.textContent = '';
      rows = [];
    },
  };
}

/* ---------- Weave implementation ---------- */
function weaveImpl(root) {
  const rt = { ...dom, signal };
  const html =
    '<table><tbody>@for (r of rows(); track r.id) {' +
    '<tr class={{ r.id === sel() ? "danger" : "" }}><td>{{ r.id }}</td><td><a>{{ r.label }}</a></td></tr>' +
    '}</tbody></table>';
  const { code } = compileTemplate(html, { mode: 'function', scope: ['rows', 'sel'] });
  const render = new Function('ctx', 'rt', '_c', code);

  const rows = signal([]);
  const sel = signal(-1);
  const node = render({ rows, sel }, rt, {});
  root.appendChild(node);

  return {
    create(data) {
      // fresh objects each op; keyed reconcile does the DOM work
      rows.set(data.map((d) => ({ id: d.id, label: d.label })));
    },
    updateEvery10th() {
      const cur = rows();
      const next = cur.slice();
      for (let i = 0; i < next.length; i += 10) next[i] = { ...next[i], label: next[i].label + ' !!!' };
      rows.set(next);
    },
    swap() {
      const cur = rows();
      if (cur.length < 999) return;
      const next = cur.slice();
      const t = next[1]; next[1] = next[998]; next[998] = t;
      rows.set(next);
    },
    select() {
      sel.set(rows()[1]?.id ?? -1);
    },
    remove() {
      const next = rows().slice();
      next.splice(1, 1);
      rows.set(next);
    },
    clear() {
      rows.set([]);
    },
  };
}

/* ---------- runner ---------- */
function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function time(fn) {
  const t0 = performance.now();
  fn();
  // force synchronous layout so the measurement includes real reflow cost
  void document.body.offsetHeight;
  return performance.now() - t0;
}

/**
 * Run one operation `reps` times against a fresh mount each rep, returning the
 * median ms. `prep` (re-)creates the pre-condition (e.g. 1k rows) OUTSIDE the clock.
 */
function benchOp(makeImpl, reps, warmup, setup, op) {
  const samples = [];
  for (let r = 0; r < warmup + reps; r++) {
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;left:-99999px;top:0';
    document.body.appendChild(root);
    const impl = makeImpl(root);
    if (setup) setup(impl);
    void document.body.offsetHeight;
    const ms = time(() => op(impl));
    if (r >= warmup) samples.push(ms);
    root.remove();
  }
  return median(samples);
}

globalThis.__bench = () => {
  const N = 1000;
  const BIG = 10000;
  const reps = 40, warmup = 8;
  const bigReps = 10, bigWarmup = 3;
  const SUITES = 5; // repeat the whole suite; per-op we take the median across suites

  const ops = [
    { key: 'create1k', label: 'create 1,000 rows', reps, warmup, setup: null, op: (i) => i.create(buildData(N)) },
    { key: 'create10k', label: 'create 10,000 rows', reps: bigReps, warmup: bigWarmup, setup: null, op: (i) => i.create(buildData(BIG)) },
    { key: 'update10th', label: 'update every 10th (1k)', reps, warmup, setup: (i) => i.create(buildData(N)), op: (i) => i.updateEvery10th() },
    { key: 'swap', label: 'swap 2 rows (1k)', reps, warmup, setup: (i) => i.create(buildData(N)), op: (i) => i.swap() },
    { key: 'select', label: 'select a row (1k)', reps, warmup, setup: (i) => i.create(buildData(N)), op: (i) => i.select() },
    { key: 'remove', label: 'remove a row (1k)', reps, warmup, setup: (i) => i.create(buildData(N)), op: (i) => i.remove() },
    { key: 'clear', label: 'clear 1,000 rows', reps, warmup, setup: (i) => i.create(buildData(N)), op: (i) => i.clear() },
  ];

  const results = [];
  for (const o of ops) {
    const vs = [], ws = [];
    for (let s = 0; s < SUITES; s++) {
      vs.push(benchOp(vanillaImpl, o.reps, o.warmup, o.setup, o.op));
      ws.push(benchOp(weaveImpl, o.reps, o.warmup, o.setup, o.op));
    }
    const vanilla = median(vs);
    const weave = median(ws);
    // Sub-timer-resolution baselines (e.g. select toggling two classes) can't yield a
    // trustworthy ratio — report the absolute times and omit the factor rather than
    // print a noise-driven "7×" / divide-by-zero.
    const factor = vanilla >= 0.1 ? weave / vanilla : null;
    results.push({ key: o.key, label: o.label, vanilla, weave, factor });
  }
  return results;
};
