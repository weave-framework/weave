import { test, assert } from '../../../../tools/harness.js';
import { effect } from '@weave-framework/runtime';
import { selectionModel, type SelectionModel, type SelectionChange } from '@weave-framework/ui/cdk';

interface Row {
  id: number;
  name: string;
}

/* ── single mode ── */
test('single: select replaces the previous value and emits the delta', () => {
  const changes: SelectionChange<string>[] = [];
  const m: SelectionModel<string> = selectionModel<string>({ onChange: (c) => changes.push(c) });
  assert.equal(m.multiple, false);
  assert.ok(m.isEmpty());
  m.select('a');
  assert.deepEqual(m.selected(), ['a']);
  m.select('b');
  assert.deepEqual(m.selected(), ['b'], 'single replaces');
  assert.deepEqual(changes.at(-1), { added: ['b'], removed: ['a'] });
  assert.equal(m.count(), 1);
});

test('single: select(...many) keeps only the last given', () => {
  const m: SelectionModel<string> = selectionModel<string>();
  m.select('a', 'b', 'c');
  assert.deepEqual(m.selected(), ['c']);
});

/* ── multiple mode ── */
test('multiple: select adds, deselect removes, order preserved', () => {
  const changes: SelectionChange<string>[] = [];
  const m: SelectionModel<string> = selectionModel<string>({ multiple: true, onChange: (c) => changes.push(c) });
  m.select('a', 'b');
  assert.deepEqual(m.selected(), ['a', 'b']);
  assert.deepEqual(changes.at(-1), { added: ['a', 'b'], removed: [] });
  m.select('c');
  assert.deepEqual(m.selected(), ['a', 'b', 'c']);
  m.deselect('b');
  assert.deepEqual(m.selected(), ['a', 'c']);
  assert.deepEqual(changes.at(-1), { added: [], removed: ['b'] });
});

test('toggle flips a value (multi keeps others)', () => {
  const m: SelectionModel<string> = selectionModel<string>({ multiple: true });
  m.select('a');
  m.toggle('b');
  assert.deepEqual(m.selected(), ['a', 'b']);
  m.toggle('a');
  assert.deepEqual(m.selected(), ['b']);
});

test('toggle in single mode replaces', () => {
  const m: SelectionModel<string> = selectionModel<string>();
  m.toggle('a');
  m.toggle('b');
  assert.deepEqual(m.selected(), ['b']);
});

/* ── no-op guards (no spurious change events) ── */
test('re-selecting an already-selected value is a no-op (no change emitted)', () => {
  let count: number = 0;
  const m: SelectionModel<string> = selectionModel<string>({ multiple: true, onChange: () => count++ });
  m.select('a');
  assert.equal(count, 1);
  m.select('a');
  assert.equal(count, 1, 'no second change');
  m.deselect('zzz'); // not present
  assert.equal(count, 1, 'deselecting absent value is a no-op');
});

test('clear empties + emits removed=all; clearing an empty model is a no-op', () => {
  const changes: SelectionChange<string>[] = [];
  const m: SelectionModel<string> = selectionModel<string>({ multiple: true, onChange: (c) => changes.push(c) });
  m.select('a', 'b');
  m.clear();
  assert.ok(m.isEmpty());
  assert.deepEqual(changes.at(-1), { added: [], removed: ['a', 'b'] });
  const n: number = changes.length;
  m.clear();
  assert.equal(changes.length, n, 'clearing empty emits nothing');
});

test('setSelection replaces wholesale with a minimal delta', () => {
  const changes: SelectionChange<string>[] = [];
  const m: SelectionModel<string> = selectionModel<string>({ multiple: true, onChange: (c) => changes.push(c) });
  m.select('a', 'b');
  m.setSelection('b', 'c');
  assert.deepEqual(m.selected(), ['b', 'c']);
  assert.deepEqual(changes.at(-1), { added: ['c'], removed: ['a'] }, 'only the diff, b untouched');
});

/* ── initial seed ── */
test('initial seed: deduped in multi, truncated to the last in single', () => {
  const multi: SelectionModel<number> = selectionModel<number>({ multiple: true, initial: [1, 2, 2, 3] });
  assert.deepEqual(multi.selected(), [1, 2, 3], 'deduped');
  const single: SelectionModel<number> = selectionModel<number>({ initial: [1, 2, 3] });
  assert.deepEqual(single.selected(), [3], 'single keeps the last');
});

/* ── compareWith identity ── */
test('compareWith lets distinct object copies match by key', () => {
  const rows: Row[] = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Alan' }];
  const m: SelectionModel<Row> = selectionModel<Row>({ multiple: true, compareWith: (a, b) => a.id === b.id });
  m.select(rows[0]);
  // A fresh object with the same id must read as selected + toggle off.
  assert.ok(m.isSelected({ id: 1, name: 'Ada (copy)' }));
  m.toggle({ id: 1, name: 'copy' });
  assert.ok(m.isEmpty(), 'toggled off via key identity');
});

/* ── reactivity ── */
test('selected()/count() are reactive signals (effects re-run on change)', () => {
  const m: SelectionModel<string> = selectionModel<string>({ multiple: true });
  let runs: number = 0;
  let last: number = -1;
  const stop: () => void = effect(() => {
    last = m.count();
    runs++;
  });
  const base: number = runs;
  m.select('a');
  assert.ok(runs > base, 'effect re-ran on select');
  assert.equal(last, 1);
  m.select('b');
  assert.equal(last, 2);
  stop();
});
