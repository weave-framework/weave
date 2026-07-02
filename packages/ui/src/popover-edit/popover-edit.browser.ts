import { test, assert } from '../../../../tools/harness.js';
import { popoverEdit, type PopoverEditRef } from '@weave-framework/ui/popover-edit';

const panel = (): HTMLElement | null => document.body.querySelector('.weave-popover-edit');
const editorInput = (): HTMLInputElement | null => document.body.querySelector('.weave-popover-edit__input');
const backdrop = (): HTMLElement | null => document.body.querySelector('.weave-overlay-backdrop');
const panelKey = (k: string): void => {
  panel()!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
};

interface Host {
  el: HTMLButtonElement;
  remove: () => void;
}
function makeHost(): Host {
  const el: HTMLButtonElement = document.createElement('button');
  el.type = 'button';
  el.textContent = 'cell';
  document.body.appendChild(el);
  return { el, remove: (): void => el.remove() };
}

test('popover-edit: host gets aria-haspopup; click opens an editor seeded with the value', () => {
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'Ada', onCommit: () => {} });
  assert.equal(h.el.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(panel(), null);
  h.el.click();
  assert.ok(panel(), 'editor opened');
  assert.equal(h.el.getAttribute('aria-expanded'), 'true');
  assert.equal(editorInput()!.value, 'Ada', 'seeded with the current value');
  ref.destroy();
  h.remove();
});

test('popover-edit: Enter commits the edited value + closes + returns focus to the host', () => {
  const committed: string[] = [];
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'Ada', onCommit: (v) => committed.push(v) });
  h.el.click();
  editorInput()!.value = 'Grace';
  panelKey('Enter');
  assert.deepEqual(committed, ['Grace']);
  assert.equal(panel(), null, 'closed on commit');
  assert.equal(document.activeElement, h.el, 'focus returned to the host');
  ref.destroy();
  h.remove();
});

test('popover-edit: Escape cancels — no commit, closes', () => {
  const committed: string[] = [];
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'Ada', onCommit: (v) => committed.push(v) });
  h.el.click();
  editorInput()!.value = 'Grace';
  panelKey('Escape');
  assert.equal(committed.length, 0, 'no commit on cancel');
  assert.equal(panel(), null, 'closed');
  ref.destroy();
  h.remove();
});

test('popover-edit: click-away (backdrop) commits (spreadsheet feel)', () => {
  const committed: string[] = [];
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'Ada', onCommit: (v) => committed.push(v) });
  h.el.click();
  editorInput()!.value = 'Alan';
  backdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.deepEqual(committed, ['Alan'], 'click-away committed');
  assert.equal(panel(), null);
  ref.destroy();
  h.remove();
});

test('popover-edit: F2 opens the editor', () => {
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'x', onCommit: () => {} });
  h.el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F2' }));
  assert.ok(panel(), 'F2 opened the editor');
  ref.destroy();
  h.remove();
});

test('popover-edit: disabled never opens', () => {
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'x', onCommit: () => {}, disabled: true });
  h.el.click();
  assert.equal(panel(), null, 'disabled ignores activation');
  ref.destroy();
  h.remove();
});

test('popover-edit: a custom editor factory supplies its own field + read()', () => {
  const committed: string[] = [];
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, {
    value: () => 'lt',
    onCommit: (v) => committed.push(v),
    editor: (value: string) => {
      const sel: HTMLSelectElement = document.createElement('select');
      for (const o of ['lt', 'us', 'jp']) {
        const opt: HTMLOptionElement = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.value = value;
      return { element: sel, read: () => sel.value };
    },
  });
  h.el.click();
  const sel: HTMLSelectElement = panel()!.querySelector('select') as HTMLSelectElement;
  assert.equal(sel.value, 'lt', 'custom editor seeded');
  sel.value = 'jp';
  panelKey('Enter');
  assert.deepEqual(committed, ['jp'], 'custom editor read() on commit');
  ref.destroy();
  h.remove();
});

test('popover-edit: destroy removes listeners + aria (a later click is inert)', () => {
  const h: Host = makeHost();
  const ref: PopoverEditRef = popoverEdit(h.el, { value: () => 'x', onCommit: () => {} });
  ref.destroy();
  assert.equal(h.el.hasAttribute('aria-haspopup'), false, 'aria cleaned up');
  h.el.click();
  assert.equal(panel(), null, 'no editor after destroy');
  h.remove();
});
