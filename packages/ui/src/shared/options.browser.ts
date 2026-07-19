import { test, assert } from '../../../../tools/harness.js';
import {
  optValue,
  optLabel,
  optDescription,
  optDisabled,
  normalize,
  emitSelection,
  type OptionAccessors,
} from './options.js';

/**
 * The option model shared by Menu, Select and Autocomplete. Pure functions, but the whole point of them
 * is a chain of FALLBACKS — accessor → string self → `.label` → `.value` — and a fallback chain is
 * exactly the shape where one wrong link is invisible until a specific option shape hits it. Covered
 * only through three components before this file, none of which exercise the odd shapes.
 */

interface Row {
  value: string;
  label?: string;
  description?: string;
  disabled?: boolean;
}

const none: OptionAccessors<unknown> = {};

test('options: a plain string is its own value and label, with no description', () => {
  assert.equal(optValue('apple', none as OptionAccessors<string>), 'apple');
  assert.equal(optLabel('apple', none as OptionAccessors<string>), 'apple');
  assert.equal(optDescription('apple', none as OptionAccessors<string>), undefined);
  assert.equal(optDisabled('apple', none as OptionAccessors<string>), false, 'a bare string is never disabled');
});

test('options: an object falls back .label → .value for its label', () => {
  const acc: OptionAccessors<Row> = {};
  assert.equal(optLabel({ value: 'a', label: 'Apple' }, acc), 'Apple', 'label wins when present');
  assert.equal(optLabel({ value: 'a' }, acc), 'a', 'and falls back to value when absent');
});

test('options: accessors override every default', () => {
  const acc: OptionAccessors<Row> = {
    optionValue: (o) => `id-${o.value}`,
    optionLabel: (o) => o.value.toUpperCase(),
    optionDescription: () => 'from accessor',
    optionDisabled: () => true,
  };
  const row: Row = { value: 'a', label: 'ignored', description: 'ignored', disabled: false };
  assert.equal(optValue(row, acc), 'id-a');
  assert.equal(optLabel(row, acc), 'A');
  assert.equal(optDescription(row, acc), 'from accessor');
  assert.equal(optDisabled(row, acc), true, 'the accessor wins over the field');
});

test('options: a null/undefined description is dropped, not stringified', () => {
  // `String(null)` is "null", which would render the word null under the option — the kind of bug that
  // ships because the happy path never has a null there.
  const acc: OptionAccessors<Record<string, unknown>> = {};
  assert.equal(optDescription({ value: 'a', description: null }, acc), undefined, 'null → undefined');
  assert.equal(optDescription({ value: 'a', description: undefined }, acc), undefined, 'undefined → undefined');
  assert.equal(optDescription({ value: 'a', description: 0 }, acc), '0', 'but a real falsy value survives');
});

test('options: a non-string value is coerced for the value, not dropped', () => {
  const acc: OptionAccessors<Record<string, unknown>> = {};
  assert.equal(optValue({ value: 42 }, acc), '42', 'a numeric id becomes its string form');
  assert.equal(optLabel({ value: 42 }, acc), '42', 'and labels the same way when no label exists');
});

test('options: normalize collects exactly the canonical fields', () => {
  const acc: OptionAccessors<Row> = {};
  const n: ReturnType<typeof normalize<Row>> = normalize({ value: 'a', label: 'Apple', description: 'fruit', disabled: true }, acc);
  assert.equal(n.value, 'a');
  assert.equal(n.label, 'Apple');
  assert.equal(n.description, 'fruit');
  assert.equal(n.disabled, true);
  assert.deepEqual(n.item, { value: 'a', label: 'Apple', description: 'fruit', disabled: true }, 'keeps the original');
});

test('options: emit mode decides whether a selection reports the value or the object', () => {
  const row: Row = { value: 'a', label: 'Apple' };
  assert.equal(emitSelection(row, {} as OptionAccessors<Row>), 'a', 'default emits the value');
  assert.equal(emitSelection(row, { emit: 'value' } as OptionAccessors<Row>), 'a', 'explicit value mode');
  assert.deepEqual(emitSelection(row, { emit: 'object' } as OptionAccessors<Row>), row, 'object mode emits the item');
});
