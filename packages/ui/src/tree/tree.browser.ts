import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { setup, template, type TreeProps, type TreeContext } from '@weave-framework/ui/tree';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

interface FileNode {
  id: string;
  name: string;
  children?: FileNode[];
}
const TREE: FileNode[] = [
  {
    id: 'src',
    name: 'src',
    children: [
      { id: 'index', name: 'index.ts' },
      { id: 'ui', name: 'ui', children: [{ id: 'button', name: 'button.ts' }] },
    ],
  },
  { id: 'readme', name: 'README.md' },
];

// A flat, DFS-ordered model of the same shape (depth carried per node).
interface FlatRow {
  id: string;
  name: string;
  depth: number;
}
const FLAT: FlatRow[] = [
  { id: 'src', name: 'src', depth: 0 },
  { id: 'index', name: 'index.ts', depth: 1 },
  { id: 'ui', name: 'ui', depth: 1 },
  { id: 'button', name: 'button.ts', depth: 2 },
  { id: 'readme', name: 'README.md', depth: 0 },
];

type Ctx<N> = TreeContext<N>;
type MakeRender<N> = (ctx: Ctx<N>, rt: unknown, c: unknown) => (ctx: Ctx<N>, slots: Record<string, () => Node>) => HTMLElement;

interface Mounted<N> {
  host: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

const SCOPE: string[] = inferCtxNames(parseTemplate(template));

async function mount<N>(props: TreeProps<N>): Promise<Mounted<N>> {
  const owner: Owner = createOwner();
  const host: HTMLElement = runInOwner(owner, () => {
    const ctx: Ctx<N> = setup<N>(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender<N> = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender<N>;
    return make(ctx, rt, {})(ctx, {});
  });
  document.body.appendChild(host);
  await tick();
  return {
    host,
    owner,
    dispose: (): void => {
      disposeOwner(owner);
      host.remove();
    },
  };
}

const nodes = (m: Mounted<unknown>): HTMLElement[] =>
  Array.from(m.host.querySelectorAll<HTMLElement>('.weave-tree__node'));
const labels = (m: Mounted<unknown>): string[] => nodes(m).map((n) => n.textContent ?? '');
const byName = (m: Mounted<unknown>, name: string): HTMLElement =>
  nodes(m).find((n) => (n.textContent ?? '') === name) as HTMLElement;
const press = (m: Mounted<unknown>, key: string): void => {
  // m.host IS the role=tree root (the template's single root element).
  m.host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};

const NESTED: TreeProps<FileNode> = { nodes: TREE, label: (n) => n.name };

/* ── structure + nested model ── */
test('tree: role=tree of role=treeitem; only visible (collapsed) roots render', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED });
  assert.equal(m.host.getAttribute('role'), 'tree', 'the root is a role=tree container');
  assert.equal(nodes(m).length, 2, 'two roots, children hidden');
  assert.deepEqual(labels(m), ['src', 'README.md']);
  const src: HTMLElement = byName(m, 'src');
  assert.equal(src.getAttribute('role'), 'treeitem');
  assert.equal(src.getAttribute('aria-expanded'), 'false', 'expandable folder starts collapsed');
  assert.equal(byName(m, 'README.md').hasAttribute('aria-expanded'), false, 'a leaf has no aria-expanded');
  m.dispose();
});

test('tree: aria-level / -setsize / -posinset reflect the hierarchy', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, defaultExpanded: [TREE[0]] });
  const src: HTMLElement = byName(m, 'src');
  assert.equal(src.getAttribute('aria-level'), '1');
  assert.equal(src.getAttribute('aria-setsize'), '2');
  assert.equal(src.getAttribute('aria-posinset'), '1');
  const index: HTMLElement = byName(m, 'index.ts');
  assert.equal(index.getAttribute('aria-level'), '2');
  assert.equal(index.getAttribute('aria-setsize'), '2', 'index.ts + ui are siblings');
  m.dispose();
});

/* ── expand / collapse ── */
test('tree: clicking the disclosure toggle reveals + hides children', async () => {
  const expandedSets: string[][] = [];
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, onExpandedChange: (e) => expandedSets.push(e.map((n) => n.id)) });
  const toggle: HTMLElement = byName(m, 'src').querySelector('.weave-tree__toggle') as HTMLElement;
  toggle.click();
  assert.deepEqual(labels(m), ['src', 'index.ts', 'ui', 'README.md'], 'children shown under src');
  assert.equal(byName(m, 'src').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(expandedSets.at(-1), ['src']);
  toggle.click();
  assert.deepEqual(labels(m), ['src', 'README.md'], 'collapsed again');
  assert.deepEqual(expandedSets.at(-1), []);
  m.dispose();
});

test('tree: a non-selectable folder toggles on row click (whole node)', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED });
  byName(m, 'src').click(); // no selection → row click expands
  assert.deepEqual(labels(m), ['src', 'index.ts', 'ui', 'README.md']);
  m.dispose();
});

test('tree: controlled expanded — the prop is the source of truth; toggles emit without self-mutating', async () => {
  const expanded: ReturnType<typeof signal<FileNode[]>> = signal<FileNode[]>([]);
  const emitted: string[][] = [];
  const m: Mounted<FileNode> = await mount<FileNode>({
    nodes: TREE,
    label: (n) => n.name,
    get expanded(): FileNode[] {
      return expanded();
    },
    onExpandedChange: (e) => emitted.push(e.map((n) => n.id)),
  });
  assert.deepEqual(labels(m), ['src', 'README.md'], 'starts collapsed (controlled = [])');
  byName(m, 'src').querySelector<HTMLElement>('.weave-tree__toggle')!.click();
  assert.deepEqual(labels(m), ['src', 'README.md'], 'no self-open — the prop still says collapsed');
  assert.deepEqual(emitted.at(-1), ['src'], 'but the change was emitted for the owner to apply');
  expanded.set([TREE[0]]); // owner applies it → the tree reacts
  assert.deepEqual(labels(m), ['src', 'index.ts', 'ui', 'README.md'], 'external state drove the expansion');
  m.dispose();
});

/* ── flat model ── */
test('tree: flat model (getLevel) flattens + hides descendants of collapsed nodes', async () => {
  const flat: TreeProps<FlatRow> = { nodes: FLAT, getLevel: (n) => n.depth, label: (n) => n.name };
  const m: Mounted<FlatRow> = await mount<FlatRow>({ ...flat, defaultExpanded: [FLAT[0]] }); // src open, ui closed
  assert.deepEqual(labels(m), ['src', 'index.ts', 'ui', 'README.md'], 'ui collapsed hides button.ts');
  assert.equal(byName(m, 'ui').getAttribute('aria-expanded'), 'false');
  assert.equal(byName(m, 'button.ts') as unknown, undefined, 'button.ts hidden under collapsed ui');
  byName(m, 'ui').querySelector<HTMLElement>('.weave-tree__toggle')!.click();
  assert.deepEqual(labels(m), ['src', 'index.ts', 'ui', 'button.ts', 'README.md']);
  m.dispose();
});

/* ── selection ── */
test('tree: selectable single — clicking a node selects it (aria-selected), replaces prior', async () => {
  const changes: string[][] = [];
  const m: Mounted<FileNode> = await mount<FileNode>({
    ...NESTED,
    defaultExpanded: [TREE[0]],
    selectable: true,
    onSelectionChange: (s) => changes.push(s.map((n) => n.id)),
  });
  byName(m, 'index.ts').click();
  assert.equal(byName(m, 'index.ts').getAttribute('aria-selected'), 'true');
  assert.deepEqual(changes.at(-1), ['index']);
  byName(m, 'README.md').click();
  assert.equal(byName(m, 'index.ts').getAttribute('aria-selected'), 'false', 'single mode replaced');
  assert.equal(byName(m, 'README.md').getAttribute('aria-selected'), 'true');
  m.dispose();
});

test('tree: selectable multiple accumulates + toggles off', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, defaultExpanded: [TREE[0]], selectable: true, selectionMode: 'multiple' });
  byName(m, 'index.ts').click();
  byName(m, 'README.md').click();
  assert.equal(byName(m, 'index.ts').getAttribute('aria-selected'), 'true');
  assert.equal(byName(m, 'README.md').getAttribute('aria-selected'), 'true');
  byName(m, 'index.ts').click(); // toggle off
  assert.equal(byName(m, 'index.ts').getAttribute('aria-selected'), 'false');
  m.dispose();
});

test('tree: a selectable folder click selects but does NOT expand (chevron / keys do)', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, selectable: true });
  byName(m, 'src').click();
  assert.equal(byName(m, 'src').getAttribute('aria-selected'), 'true');
  assert.deepEqual(labels(m), ['src', 'README.md'], 'not expanded by the row click');
  byName(m, 'src').querySelector<HTMLElement>('.weave-tree__toggle')!.click();
  assert.deepEqual(labels(m), ['src', 'index.ts', 'ui', 'README.md'], 'chevron still expands');
  m.dispose();
});

/* ── keyboard (WAI-ARIA tree) ── */
test('tree: ArrowRight expands a collapsed folder, then steps into the first child', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED });
  press(m, 'ArrowRight'); // active defaults to src → expand
  assert.equal(byName(m, 'src').getAttribute('aria-expanded'), 'true');
  press(m, 'ArrowRight'); // already expanded → move to first child
  assert.equal(document.activeElement, byName(m, 'index.ts'), 'focus stepped into index.ts');
  m.dispose();
});

test('tree: ArrowLeft collapses an expanded folder, then moves to the parent', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, defaultExpanded: [TREE[0]] });
  press(m, 'ArrowDown'); // src → index.ts
  assert.equal(document.activeElement, byName(m, 'index.ts'));
  press(m, 'ArrowLeft'); // leaf → move to parent
  assert.equal(document.activeElement, byName(m, 'src'), 'moved up to the parent');
  press(m, 'ArrowLeft'); // expanded folder → collapse
  assert.equal(byName(m, 'src').getAttribute('aria-expanded'), 'false');
  m.dispose();
});

test('tree: Up/Down rove focus; a single tab stop (roving tabindex)', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, defaultExpanded: [TREE[0]] });
  assert.equal(nodes(m).filter((n) => n.getAttribute('tabindex') === '0').length, 1, 'exactly one tabbable node');
  assert.equal(byName(m, 'src').getAttribute('tabindex'), '0', 'first node tabbable initially');
  press(m, 'ArrowDown');
  assert.equal(document.activeElement, byName(m, 'index.ts'));
  press(m, 'ArrowDown');
  assert.equal(document.activeElement, byName(m, 'ui'));
  m.dispose();
});

test('tree: Enter/Space activates the focused node (selects when selectable)', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, defaultExpanded: [TREE[0]], selectable: true });
  press(m, 'ArrowDown'); // → index.ts
  press(m, 'Enter');
  assert.equal(byName(m, 'index.ts').getAttribute('aria-selected'), 'true');
  m.dispose();
});

/* ── reorder (CDK dropList) ── */
const dragPointer = (target: EventTarget, type: string, clientY: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 20, clientY }));
};

test('tree: reorderable renders a per-node drag handle + a --reorderable class', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, reorderable: true });
  assert.ok(m.host.classList.contains('weave-tree--reorderable'));
  assert.ok(nodes(m).every((n) => n.querySelector('.weave-tree__drag-handle')), 'each node has a handle');
  m.dispose();
});

test('tree: dragging a node handle past a sibling emits onReorder (visible order)', async () => {
  const drops: Array<{ previousIndex: number; currentIndex: number }> = [];
  const m: Mounted<FileNode> = await mount<FileNode>({
    ...NESTED,
    defaultExpanded: [TREE[0]],
    reorderable: true,
    onReorder: (e) => drops.push(e),
  });
  const vis: HTMLElement[] = nodes(m); // [src, index.ts, ui, README.md]
  const handle: HTMLElement = vis[1].querySelector('.weave-tree__drag-handle') as HTMLElement;
  const r2: DOMRect = vis[2].getBoundingClientRect();
  const y: number = r2.top + r2.height / 2 + 1; // just past node 2's midpoint
  dragPointer(handle, 'pointerdown', vis[1].getBoundingClientRect().top + 4);
  dragPointer(m.host, 'pointermove', y);
  dragPointer(m.host, 'pointerup', y);
  assert.deepEqual(drops.at(-1), { previousIndex: 1, currentIndex: 2 }, 'index.ts moved down one');
  m.dispose();
});

test('tree: Space/Enter still selects when reorderable (dropList keyboard is off)', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({ ...NESTED, defaultExpanded: [TREE[0]], reorderable: true, selectable: true });
  press(m, 'ArrowDown'); // focus → node 1 (index.ts)
  press(m, 'Enter');
  assert.equal(nodes(m)[1].getAttribute('aria-selected'), 'true', 'Enter selects; no keyboard-drag hijack');
  m.dispose();
});

/* ── content render fn ── */
test('tree: a node render fn mounts arbitrary content', async () => {
  const m: Mounted<FileNode> = await mount<FileNode>({
    nodes: TREE,
    node: (n: FileNode): Node => {
      const b: HTMLElement = document.createElement('strong');
      b.className = 'node-badge';
      b.textContent = n.name.toUpperCase();
      return b;
    },
  });
  const badge: Element | null = byName(m, 'SRC').querySelector('.node-badge');
  assert.ok(badge, 'render-fn node mounted');
  m.dispose();
});
