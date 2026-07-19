import { test, assert } from '../../../../tools/harness.js';
import { buildPositions, type MenuPosition } from './positions.js';
import type { ConnectedPosition, PositionName } from '../cdk/index.js';

/**
 * The flip-fallback list every anchored panel is positioned with — seven components depend on it
 * (Menu, Select, Autocomplete, both date pickers, Timepicker, Popover-edit). It is 40 lines and was
 * covered only through those consumers, none of which assert the OPPOSITE table itself. A wrong entry
 * there means a panel that flips to the wrong edge on overflow: visible only at a viewport boundary,
 * which is exactly where nobody tests by hand.
 */

const ALL: PositionName[] = [
  'top',
  'bottom',
  'left',
  'right',
  'top-start',
  'bottom-start',
  'top-end',
  'bottom-end',
  'left-start',
  'right-start',
  'left-end',
  'right-end',
];

test('positions: a preset gets its opposite appended, so it can flip', () => {
  assert.deepEqual(buildPositions('bottom', 'top'), ['bottom', 'top']);
  assert.deepEqual(buildPositions('top-end', 'bottom'), ['top-end', 'bottom-end']);
  assert.deepEqual(buildPositions('left-start', 'bottom'), ['left-start', 'right-start']);
});

test('positions: nothing requested falls back to the component default + its opposite', () => {
  assert.deepEqual(buildPositions(undefined, 'bottom-start'), ['bottom-start', 'top-start']);
});

test('positions: an explicit anchor pair is used as-is (no flip appended)', () => {
  // An explicit pair is a deliberate choice — appending an "opposite" would silently move a panel the
  // caller had positioned by hand. It shift-clamps to fit instead.
  const explicit: ConnectedPosition = {
    originX: 'start',
    originY: 'bottom',
    overlayX: 'start',
    overlayY: 'top',
  } as ConnectedPosition;
  const out: MenuPosition[] = buildPositions(explicit, 'bottom');
  assert.equal(out.length, 1, 'exactly one entry');
  assert.deepEqual(out[0], explicit, 'and it is the pair given');
});

test('positions: every preset has an opposite, and flipping twice returns to the start', () => {
  // An involution: this catches a typo'd or missing entry in the OPPOSITE table, which is the whole
  // failure mode here — one wrong pair sends a panel to the wrong edge only when it overflows.
  for (const name of ALL) {
    const [first, opposite] = buildPositions(name, 'bottom') as PositionName[];
    assert.equal(first, name, `${name}: kept first`);
    assert.ok(opposite, `${name}: has an opposite`);
    assert.notEqual(opposite, name, `${name}: the opposite is not itself`);
    const [, back] = buildPositions(opposite, 'bottom') as PositionName[];
    assert.equal(back, name, `${name} → ${opposite} → ${back}: flipping twice comes home`);
  }
});

test('positions: a flip preserves the alignment suffix', () => {
  // `top-end` must flip to `bottom-end`, never to a bare `bottom` — the panel would jump sideways.
  for (const suffix of ['-start', '-end']) {
    for (const base of ['top', 'bottom', 'left', 'right']) {
      const name: PositionName = `${base}${suffix}` as PositionName;
      const [, opposite] = buildPositions(name, 'bottom') as PositionName[];
      assert.ok(
        String(opposite).endsWith(suffix),
        `${name} flips to ${opposite}, which must keep "${suffix}"`
      );
    }
  }
});
