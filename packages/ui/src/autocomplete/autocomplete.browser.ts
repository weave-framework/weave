import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Signal, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { overlayContainer } from '@weave-framework/ui/cdk';
import { setup, template, type AutocompleteProps, type AutocompleteContext, type AutocompleteControl } from '@weave-framework/ui/autocomplete';
import * as InputMod from '@weave-framework/ui/input';
import { toComponent } from '../internal/compose.js';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));
const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

const SCOPE: string[] = [
  'currentText', 'controlProp', 'onCommit', 'clearable', 'placeholder', 'isDisabled',
  'isRequired', 'name', 'label', 'bindInput',
];

interface Fruit {
  id: string;
  name: string;
  kind?: string;
}
const FRUITS: Fruit[] = [
  { id: 'ap', name: 'Apple', kind: 'Pome' },
  { id: 'ap2', name: 'Apricot', kind: 'Stone' },
  { id: 'ba', name: 'Banana', kind: 'Berry' },
  { id: 'ch', name: 'Cherry', kind: 'Stone' },
];

type RenderFn = (ctx: AutocompleteContext, slots: Record<string, () => Node>) => HTMLElement;
type MakeRender = (ctx: AutocompleteContext, rt: unknown, c: unknown) => RenderFn;

interface Mounted {
  root: HTMLElement;
  input: HTMLInputElement;
  dispose: () => void;
}

function mount(props: AutocompleteProps<Fruit>): Mounted {
  // Default the accessors to the Fruit shape (id/name); tests can override.
  const merged: AutocompleteProps<Fruit> = {
    optionValue: (f: Fruit): string => f.id,
    optionLabel: (f: Fruit): string => f.name,
    ...props,
  };
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: AutocompleteContext = setup<Fruit>(merged);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function(
      'ctx',
      'rt',
      '_c',
      code.replace('return render(ctx, {});', 'return render;'),
    ) as MakeRender;
    // The field IS the composed Input; a component-root template renders a fragment, so
    // grab its element before appending (append empties the fragment).
    const node: Node = make(ctx, rt, { Input: toComponent(InputMod as never) })(ctx, {});
    const el: HTMLElement = ((node as DocumentFragment).firstElementChild ?? node) as HTMLElement;
    document.body.appendChild(node);
    return el;
  });
  return {
    root,
    input: root.querySelector('.weave-input__field') as HTMLInputElement,
    dispose: (): void => {
      disposeOwner(owner);
      root.remove();
    },
  };
}

const panel = (): HTMLElement | null => overlayContainer().querySelector('.weave-autocomplete__panel');
const opts = (): HTMLElement[] =>
  Array.from(overlayContainer().querySelectorAll('.weave-autocomplete__option')) as HTMLElement[];
const optByText = (t: string): HTMLElement =>
  opts().find((o) => o.querySelector('.weave-autocomplete__label')?.textContent === t) as HTMLElement;
const typeInto = (el: HTMLInputElement, v: string): void => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (el: EventTarget, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};

interface Ctl extends AutocompleteControl {
  value: Signal<string>;
  touched: Signal<boolean>;
}
const makeControl = (initial: string, err: string | null = null): Ctl => ({
  value: signal<string>(initial),
  touched: signal<boolean>(false),
  error: (): string | null => err,
});

test('autocomplete: renders a combobox input with aria-autocomplete=list', () => {
  const { input, dispose } = mount({ options: FRUITS, placeholder: 'Fruit…' });
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('aria-autocomplete'), 'list');
  assert.equal(input.placeholder, 'Fruit…');
  assert.equal(panel(), null, 'closed initially');
  dispose();
});

test('autocomplete: typing filters static options (case-insensitive, by label)', () => {
  const { input, dispose } = mount({ options: FRUITS });
  typeInto(input, 'ap');
  assert.ok(panel(), 'panel opens on input');
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  const labels: string[] = opts().map((o) => o.querySelector('.weave-autocomplete__label')?.textContent ?? '');
  assert.deepEqual(labels, ['Apple', 'Apricot'], 'only matches shown');
  dispose();
});

test('autocomplete: an option description (via accessor) renders as subtext', () => {
  const { input, dispose } = mount({ options: FRUITS, optionDescription: (f) => f.kind });
  typeInto(input, 'a');
  assert.equal(optByText('Apple').querySelector('.weave-autocomplete__description')?.textContent, 'Pome');
  dispose();
});

test('autocomplete: choosing a suggestion fills the input (label) + fires onSelect(item)', () => {
  const picked: Fruit[] = [];
  const control: Ctl = makeControl('');
  const { input, dispose } = mount({ options: FRUITS, control, onSelect: (f) => picked.push(f) });
  typeInto(input, 'ban');
  optByText('Banana').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(control.value(), 'Banana', 'input filled with the label');
  assert.deepEqual(picked, [FRUITS[2]], 'onSelect got the whole item');
  assert.equal(panel(), null, 'closed after select');
  dispose();
});

test('autocomplete: keyboard — ArrowDown moves the active option (activedescendant), Enter selects', () => {
  const control: Ctl = makeControl('');
  const picked: Fruit[] = [];
  const { input, dispose } = mount({ options: FRUITS, control, onSelect: (f) => picked.push(f) });
  typeInto(input, 'a'); // Apple, Apricot, Banana(no)… → Apple, Apricot, Banana? 'a' matches Apple/Apricot/Banana
  key(input, 'ArrowDown'); // active = first (Apple)
  assert.ok(input.getAttribute('aria-activedescendant'), 'activedescendant set on the input');
  key(input, 'ArrowDown'); // Apricot
  key(input, 'Enter');
  assert.equal(control.value(), 'Apricot');
  assert.deepEqual(picked, [FRUITS[1]]);
  dispose();
});

test('autocomplete: Escape closes the panel but keeps the text', () => {
  const control: Ctl = makeControl('');
  const { input, dispose } = mount({ options: FRUITS, control });
  typeInto(input, 'ch');
  assert.ok(panel());
  key(input, 'Escape');
  assert.equal(panel(), null, 'closed on Escape');
  assert.equal(control.value(), 'ch', 'text kept');
  dispose();
});

test('autocomplete: an empty result set shows the no-results row', () => {
  const { input, dispose } = mount({ options: FRUITS, noResultsText: 'Nothing here' });
  typeInto(input, 'zzz');
  assert.ok(panel(), 'panel open');
  assert.equal(opts().length, 0, 'no option rows');
  assert.equal(overlayContainer().querySelector('.weave-autocomplete__empty')?.textContent, 'Nothing here');
  dispose();
});

test('autocomplete: minChars gates when the panel opens', () => {
  const { input, dispose } = mount({ options: FRUITS, minChars: 2 });
  typeInto(input, 'a');
  assert.equal(panel(), null, 'below minChars — stays closed');
  typeInto(input, 'ap');
  assert.ok(panel(), 'opens at minChars');
  dispose();
});

test('autocomplete: async optionsFor fills the panel when the promise resolves', async () => {
  const { input, dispose } = mount({
    options: [],
    optionsFor: (q: string): Promise<Fruit[]> =>
      Promise.resolve(FRUITS.filter((f) => f.name.toLowerCase().startsWith(q.toLowerCase()))),
    optionLabel: (f) => f.name,
  });
  typeInto(input, 'a');
  assert.equal(opts().length, 0, 'nothing yet (awaiting the promise)');
  await wait(0);
  assert.deepEqual(
    opts().map((o) => o.textContent),
    ['Apple', 'Apricot'],
    'panel filled after the async results land',
  );
  dispose();
});

test('autocomplete: a stale async response is ignored (only the latest query wins)', async () => {
  const pending: { resolve?: (v: Fruit[]) => void } = {};
  const { input, dispose } = mount({
    options: [],
    optionsFor: (q: string): Promise<Fruit[]> => {
      if (q === 'a') {
        return new Promise<Fruit[]>((r) => {
          pending.resolve = r;
        });
      }
      return Promise.resolve([{ id: 'ba', name: 'Banana' }]);
    },
    optionLabel: (f) => f.name,
  });
  typeInto(input, 'a'); // slow request (pending)
  typeInto(input, 'b'); // fast request resolves immediately → Banana
  await wait(0);
  pending.resolve?.([{ id: 'ap', name: 'Apple' }]); // stale 'a' response arrives late
  await wait(0);
  assert.deepEqual(opts().map((o) => o.textContent), ['Banana'], 'stale response ignored');
  dispose();
});

test('autocomplete: clearable × empties the text and closes', () => {
  const control: Ctl = makeControl('apple');
  const { root, dispose } = mount({ options: FRUITS, control, clearable: true });
  const clear: HTMLElement = root.querySelector('.weave-input__clear') as HTMLElement;
  assert.ok(clear, 'clear shown when non-empty (Input\'s ×)');
  clear.click();
  assert.equal(control.value(), '', 'text cleared');
  assert.equal(panel(), null);
  dispose();
});

test('autocomplete: invalid control adds --invalid + aria-invalid', async () => {
  const control: Ctl = makeControl('', 'Required');
  const { root, input, dispose } = mount({ options: FRUITS, control });
  control.touched.set(true);
  await tick();
  assert.ok(root.classList.contains('weave-input--invalid'), 'the composed Input reflects invalid');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  dispose();
});
