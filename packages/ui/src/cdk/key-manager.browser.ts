import { test, assert } from '../../../../tools/harness.js';
import { effect } from '@weave-framework/runtime';
import { listKeyManager, setDirection, type Orientation, type ListKeyManager, type ListKeyManagerOptions } from '@weave-framework/ui/cdk';

interface Item {
  label: string;
  disabled?: boolean;
}
const list = (labels: string[], disabledIdx: number[] = []): Item[] =>
  labels.map((label, i) => ({ label, disabled: disabledIdx.includes(i) }));

function km(items: Item[], opts: Partial<ListKeyManagerOptions<Item>> = {}): ListKeyManager<Item> {
  return listKeyManager<Item>(() => items, { isDisabled: (i) => !!i.disabled, getLabel: (i) => i.label, ...opts });
}
function key(k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, ...mods });
}

test('key-manager: ArrowDown/Up navigate; starts at -1', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b', 'c']));
  assert.equal(m.activeIndex(), -1);
  assert.equal(m.onKeydown(key('ArrowDown')), true);
  assert.equal(m.activeIndex(), 0);
  m.onKeydown(key('ArrowDown'));
  assert.equal(m.activeItem()!.label, 'b');
  m.onKeydown(key('ArrowUp'));
  assert.equal(m.activeItem()!.label, 'a');
});

test('key-manager: no wrap by default — stops at the edges', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b']));
  m.first();
  assert.equal(m.activeIndex(), 0);
  m.onKeydown(key('ArrowUp'));
  assert.equal(m.activeIndex(), 0, 'stays at first without wrap');
  m.last();
  m.onKeydown(key('ArrowDown'));
  assert.equal(m.activeIndex(), 1, 'stays at last without wrap');
});

test('key-manager: wrap cycles past the edges', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b', 'c']), { wrap: true });
  m.first();
  m.onKeydown(key('ArrowUp'));
  assert.equal(m.activeIndex(), 2, 'first → last');
  m.onKeydown(key('ArrowDown'));
  assert.equal(m.activeIndex(), 0, 'last → first');
});

test('key-manager: skips disabled items', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b', 'c'], [1]));
  m.first();
  m.onKeydown(key('ArrowDown'));
  assert.equal(m.activeItem()!.label, 'c', 'skipped disabled b');
});

test('key-manager: Home/End jump to the first/last enabled', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b', 'c', 'd'], [0, 3]));
  m.onKeydown(key('End'));
  assert.equal(m.activeItem()!.label, 'c', 'End → last enabled');
  m.onKeydown(key('Home'));
  assert.equal(m.activeItem()!.label, 'b', 'Home → first enabled');
});

test('key-manager: horizontal orientation uses Left/Right, ignores Up/Down', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b']), { orientation: 'horizontal' as Orientation });
  assert.equal(m.onKeydown(key('ArrowDown')), false, 'vertical keys ignored');
  assert.equal(m.onKeydown(key('ArrowRight')), true);
  assert.equal(m.activeIndex(), 0);
});

test('key-manager: RTL flips horizontal arrows — ArrowLeft advances, ArrowRight goes back', () => {
  const m: ListKeyManager<Item> = km(list(['a', 'b', 'c']), {
    orientation: 'horizontal' as Orientation,
    rtl: () => true,
  });
  assert.equal(m.onKeydown(key('ArrowLeft')), true, 'ArrowLeft handled in RTL');
  assert.equal(m.activeItem()!.label, 'a', 'ArrowLeft advances from -1 → first');
  m.onKeydown(key('ArrowLeft'));
  assert.equal(m.activeItem()!.label, 'b', 'ArrowLeft keeps advancing');
  m.onKeydown(key('ArrowRight'));
  assert.equal(m.activeItem()!.label, 'a', 'ArrowRight goes back in RTL');
});

test('key-manager: default rtl reads the global CDK direction (setDirection)', () => {
  setDirection('rtl');
  try {
    const m: ListKeyManager<Item> = km(list(['a', 'b']), { orientation: 'horizontal' as Orientation });
    assert.equal(m.onKeydown(key('ArrowLeft')), true, 'ArrowLeft advances under global rtl');
    assert.equal(m.activeItem()!.label, 'a');
    assert.equal(m.onKeydown(key('ArrowRight')), true);
    assert.equal(m.activeIndex(), 0, 'ArrowRight goes back (stays at first, no wrap)');
  } finally {
    setDirection('ltr'); // don't leak direction into other tests
  }
});

test('key-manager: typeahead jumps to a match and a repeated letter cycles', () => {
  const m: ListKeyManager<Item> = km(list(['Apple', 'Banana', 'Avocado', 'Cherry']), { typeahead: true });
  assert.equal(m.onKeydown(key('a')), true);
  assert.equal(m.activeItem()!.label, 'Apple');
  m.onKeydown(key('a')); // same letter → cycle to the next A-item
  assert.equal(m.activeItem()!.label, 'Avocado');
  m.onKeydown(key('a')); // wraps back
  assert.equal(m.activeItem()!.label, 'Apple');
});

test('key-manager: typeahead matches a distinct label from a fresh buffer', () => {
  const m: ListKeyManager<Item> = km(list(['Apple', 'Banana', 'Cherry']), { typeahead: true });
  assert.equal(m.onKeydown(key('c')), true);
  assert.equal(m.activeItem()!.label, 'Cherry', 'jumped straight to the C item');
});

test('key-manager: typeahead ignores modified keys and is off by default', () => {
  const plain: ListKeyManager<Item> = km(list(['Apple']));
  assert.equal(plain.onKeydown(key('a')), false, 'typeahead disabled by default');
  const m: ListKeyManager<Item> = km(list(['Apple']), { typeahead: true });
  assert.equal(m.onKeydown(key('a', { ctrlKey: true })), false, 'ctrl+a not typeahead');
});

test('key-manager: setActiveItem accepts an index or the item; activeItem is reactive', () => {
  const items: Item[] = list(['a', 'b', 'c']);
  const m: ListKeyManager<Item> = km(items);
  const seen: (string | null)[] = [];
  const stop: () => void = effect(() => {
    seen.push(m.activeItem()?.label ?? null);
  });
  m.setActiveItem(2);
  assert.equal(m.activeItem()!.label, 'c');
  m.setActiveItem(items[1]);
  assert.equal(m.activeItem()!.label, 'b');
  assert.deepEqual(seen, [null, 'c', 'b'], 'effect tracked each change');
  stop();
});
