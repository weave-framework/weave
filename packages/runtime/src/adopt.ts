/**
 * `@weave-framework/runtime/adopt` — Phase E (E1.2a) DOM-adoption primitives.
 *
 * The client counterpart to the resumable server render: re-attach reactive bindings to the DOM the server
 * already produced, IN PLACE (no re-creation), so a resumed page becomes interactive without a client
 * re-render — the point of resumability over hydration (RFC 0009 §3). This module is the atom layer: the
 * text-binding primitive for both sides of the boundary. The compiler's adopt-mode render (E1.2b) and the
 * cursor walk that navigates the marked DOM build on it.
 *
 * Its own entry — 0 bytes for a plain client SPA (invariant I3); never imported by the eager path.
 *
 * ## The dynamic-text marker
 *
 * A reactive `{{ x }}` renders as a text node before its `<!---->` anchor. In plain HTML a run of adjacent
 * text collapses into ONE node when the browser parses it — so `Hello, {{ x }}!` would come back as a single
 * `"Hello, value"` text node, and there'd be no way to re-bind just the dynamic part without clobbering the
 * static `"Hello, "`. {@link bindTextResumable} therefore emits a leading marker comment (`<!--$-->`) so the
 * dynamic text stays a SEPARATE node in the serialized HTML; {@link adoptText} then re-binds exactly that
 * node (the anchor's previous sibling) on the client.
 */
import { effect } from './reactive.js';

/** Marker-comment data that isolates a dynamic text node from a preceding static run. @internal */
export const DYN_TEXT: string = '$';

/**
 * Block-boundary markers (E1.2c). A control-flow block (`@if`/`@for`/component/…) inserts a runtime-VARIABLE
 * number of nodes before its `<!---->` anchor, so build-time child indices can't reach the block's extent or
 * anything after it. The resumable render brackets each block's content with a leading `[` marker ({@link
 * blockStart}) and an `]` end anchor (its comment data), so a client cursor can find a block's boundaries and
 * skip past it by bracket-matching ({@link blockEndOf}) — nested blocks nest their own `[`…`]` pairs.
 * @internal
 */
export const BLOCK_START: string = '[';
/** The block end-anchor's comment data — the resumable target emits `<!--]-->` where eager emits `<!---->`. @internal */
export const BLOCK_END: string = ']';

function stringify(v: unknown): string {
  return v == null || v === false ? '' : String(v);
}

/**
 * Warn once per page for a structural server/client mismatch. Once, not per occurrence: one diverged
 * index typically produces a repair for every following binding at that level, and a hundred identical
 * lines would bury the signal instead of raising it.
 */
let warnedRepair: boolean = false;

/**
 * Clear the once-per-page latch. Exists so a test can prove the warning FIRES rather than asserting
 * "at most one", which passes vacuously once any earlier test in the same page has consumed the latch —
 * a gate that cannot fail is not a gate. @internal
 */
export function resetAdoptWarnings(): void {
  warnedRepair = false;
}

function warnAdoptRepair(): void {
  if (warnedRepair) return;
  warnedRepair = true;
  console.warn(
    '[weave] resume: expected a server-rendered text node and found none — recreated it. The page works, ' +
      'but the server and client disagree about this DOM, so some bindings may be attached to the wrong ' +
      'nodes. This usually means the prerendered HTML was altered after the build, or a component rendered ' +
      'differently on the server than on the client.'
  );
}

/**
 * CREATE side (the resumable server render): insert a `[` boundary marker immediately before a block's `]`
 * end anchor, BEFORE the block helper (`ifBlock`/`eachBlock`) fills content in front of that anchor — so the
 * block's rendered nodes land between `[` and `]` and the client can bound the region. Returns the marker.
 */
export function blockStart(anchor: Comment): Comment {
  const m: Comment = document.createComment(BLOCK_START);
  anchor.parentNode!.insertBefore(m, anchor);
  return m;
}

/**
 * ADOPT side: given a block's `[` start marker, return its matching `]` end anchor by bracket-depth matching
 * (each nested `[` +1, each `]` −1; the `]` that returns to depth 0 is this block's end). Interp `$` markers
 * and plain interp anchors are ignored. Throws on unbalanced markers (a corrupt / non-resumable render).
 */
export function blockEndOf(start: Comment): Comment {
  let depth: number = 1;
  let n: Node | null = start.nextSibling;
  while (n) {
    if (n.nodeType === 8 /* Comment */) {
      const d: string = (n as Comment).data;
      if (d === BLOCK_START) depth++;
      else if (d === BLOCK_END && --depth === 0) return n as Comment;
    }
    n = n.nextSibling;
  }
  throw new Error('adopt: unbalanced block markers — no matching "]" for a "[" start.');
}

/**
 * ADOPT side: remove the server-rendered nodes strictly between a block's `[` start and `]` end (its markers
 * kept). Used to clear a block's server DOM before re-running its live helper — the island-replay path
 * (E1.2c): statics/text around a block adopt in place while the block itself re-renders reactively.
 */
export function clearBlock(start: Comment, end: Comment): void {
  let n: ChildNode | null = start.nextSibling as ChildNode | null;
  while (n && n !== end) {
    const next: ChildNode | null = n.nextSibling as ChildNode | null;
    n.remove();
    n = next;
  }
}

/**
 * ADOPT side (E1.2c-2): the island-replay entry for a control-flow block. Given the block's `[` start marker
 * (the adopt render navigates to it by computed index — `[` sits at the block anchor's template position),
 * clear the server-rendered content and return the `]` end anchor so the caller can re-run the block's normal
 * helper (`ifBlock`) against it — a fresh, fully REACTIVE branch. The static/text nodes AROUND the block stay
 * adopted in place; only the block subtree re-renders. After the clear, `]` is `start.nextSibling`.
 */
export function adoptIsland(start: Comment): Comment {
  const end: Comment = blockEndOf(start);
  clearBlock(start, end);
  return end;
}

/**
 * ADOPT side (E1.2c-4): the `n`-th following sibling of `node` — a small forward cursor. A node that sits
 * AFTER a block can't be reached by a build-time child index (the block's content is runtime-variable), but
 * the block's `]` end anchor is a stable reference and the nodes after it don't move across an island-replay,
 * so the adopt render walks `after(blockEnd, offset)` to reach a post-block binding. `n` counts raw sibling
 * steps (each static node = 1; a dynamic-text interp = 3 — its `$` marker, text, and anchor).
 */
export function after(node: Node, n: number): Node {
  let x: Node = node;
  for (let i: number = 0; i < n; i++) x = x.nextSibling!;
  return x;
}

/** The shape the compiler attaches to a resumable component: its render's adopt variant, for nested resume. */
interface AdoptableComponent {
  (props?: Record<string, unknown>, slots?: Record<string, () => Node>): Node;
  adopt?: (root: Node, ctx: Record<string, unknown>, slots: Record<string, unknown>, states: Record<string, unknown>) => unknown;
  /** E1.6 — rebuilds the child's own `computed`s onto its resumed ctx (they cannot cross the snapshot). */
  derive?: (ctx: Record<string, unknown>, props?: Record<string, unknown>) => unknown;
  /** E1.8 — the child's own `handlers(ctx)` factory, so its internal `on:` events resume against ITS ctx. */
  handlers?: (ctx: Record<string, unknown>) => Record<string, unknown>;
  /**
   * E1.12 — this component adopts through its OWN render rather than from a snapshot ctx. Set by a
   * hand-written component whose state is not `setup` bindings but live PROPS (`<RouterView>`: its router,
   * and the route match derived from it). Such a component is handed the server root via the `$adopt` prop and
   * returns that same node when it takes it; a compiled component never sets this.
   */
  adoptsSelf?: boolean;
}

/** What a self-adopting component receives as its `$adopt` prop (E1.12). */
export interface AdoptTarget {
  /** The component's server-rendered root — reuse it instead of building a fresh one. */
  root: Node;
  /** The resume state map, so the component can look up whatever it renders (a route view's ctx). */
  states: Record<string, unknown>;
  /**
   * Register a component the self-adopter resumed ITSELF (a routed view), so its own `on:` handlers resolve
   * against its ctx — the same ancestry-scoped dispatch {@link adoptComponent} gives compiled children (E1.8).
   * Passed as a callback because the collector is module-private here, and the router package must not import
   * this entry (invariant I3).
   */
  register: (root: Element, handlers: (ctx: Record<string, unknown>) => Record<string, unknown>, ctx: Record<string, unknown>) => void;
}

/** Register an instance a self-adopting component resumed on its own (E1.12). No-op outside a session. */
function registerAdopted(
  root: Element,
  handlers: (ctx: Record<string, unknown>) => Record<string, unknown>,
  ctx: Record<string, unknown>,
): void {
  if (instanceCollector && root instanceof Element) instanceCollector.push({ root, handlers, ctx });
}

/**
 * A resumed component instance's event ownership (E1.8): its server-rendered ROOT element plus the factory
 * that builds its handler table over ITS resumed ctx. The delegated dispatch resolves a `data-won-*` ref
 * against the NEAREST enclosing instance — so a `<Child>`'s own `on:click` runs the child's handler over the
 * child's signals, not the root's (whose handler-site prefixes `w0`,`w1`,… collide with the child's).
 */
export interface ResumedInstance {
  root: Element;
  handlers: (ctx: Record<string, unknown>, props?: Record<string, unknown>) => Record<string, unknown>;
  ctx: Record<string, unknown>;
  /** E1.20 — the props its parent passes it, so a handler reading `props` resolves against the live object. */
  props?: Record<string, unknown>;
}

// A collection session active during `resume`'s adopt walk: each adopted resumable child pushes its instance
// so the caller can build ancestry-scoped event resolution. Null outside a session (a plain SPA never adopts).
let instanceCollector: ResumedInstance[] | null = null;

/**
 * Run `adopt` while gathering every resumable child component instance {@link adoptComponent} adopts, then
 * return them (the root instance is added by the caller). Nestable/reentrant-safe.
 */
export function collectInstances(adopt: () => void): ResumedInstance[] {
  const prev: ResumedInstance[] | null = instanceCollector;
  const out: ResumedInstance[] = [];
  instanceCollector = out;
  try {
    adopt();
    return out;
  } finally {
    instanceCollector = prev;
  }
}

/**
 * ADOPT side (E1.2c-6): resume a static-position CHILD component in place — nested resume. `start` is the
 * component's `[` boundary marker; the child's single server root is `start.nextSibling`. If the child is
 * resumable (`Comp.adopt` present) and its ctx was snapshotted (`states[id]`), re-attach its bindings against
 * that ctx WITHOUT re-running its `setup`, and thread `states` down for its own nested children. Otherwise
 * fall back: clear the server subtree and re-mount fresh via `mount` (a plain CSR island for that child).
 *
 * Returns the child's root node — the ADOPTED one, or whatever the fallback built — so the caller can finish
 * wiring it. E1.22 needs this for a `use:` forwarded onto a component: the action must land on the root that is
 * actually on the page, whichever branch produced it.
 */
export function adoptComponent(
  start: Comment,
  id: string,
  Comp: AdoptableComponent,
  states: Record<string, unknown> | undefined,
  mount: (adopt?: AdoptTarget) => Node | null,
  events?: Record<string, EventListener>,
  slots?: Record<string, () => Node>,
  props?: Record<string, unknown>,
): Node | null {
  const end: Comment = blockEndOf(start);
  const ctx: unknown = states && states[id];
  const root: ChildNode | null = start.nextSibling as ChildNode | null;
  // E1.12 — a self-adopting component (`<RouterView>`) resumes through its own render, because what it needs
  // is live PROPS, which only `mount` carries. Hand it the server root: if it takes it, it returns that very
  // node and there is nothing to insert. If it declines, it built fresh — fall through and swap that in.
  if (Comp && Comp.adoptsSelf && root && root !== end) {
    const taken: Node | null = mount({ root, states: (states ?? {}) as Record<string, unknown>, register: registerAdopted });
    if (taken === root) return root;
    clearBlock(start, end);
    if (taken) end.parentNode!.insertBefore(taken, end);
    return taken;
  }
  if (Comp && Comp.adopt && ctx !== undefined && root && root !== end) {
    // Rebuild the child's computeds onto its resumed ctx BEFORE adopting — its bindings call them (E1.6).
    if (Comp.derive) Comp.derive(ctx as Record<string, unknown>, props ?? {}); // E1.25 — props initialise bindings too
    // E1.17 — the child's `<slot>`s island-replay through the PARENT's slot fns, so they must reach the adopt
    // walk. Passing `{}` here is what forced every container component to fall back to CSR.
    Comp.adopt(root, ctx as Record<string, unknown>, slots ?? {}, states as Record<string, unknown>);
    // E1.13 — re-attach the PARENT's component-level `on:` handlers. On the create path `defineComponent`
    // forwards them onto the child's root; adopt never runs that path, so without this they silently vanish.
    // Mirror its rule: a key the child itself consumed (a same-named binding in its ctx) is the child's own.
    if (events && root instanceof Element) {
      for (const key of Object.keys(events)) {
        if (ctx && key in (ctx as Record<string, unknown>)) continue;
        root.addEventListener(key.slice(2).toLowerCase(), events[key]);
      }
    }
    // E1.8 — register the child so its OWN events resolve against its ctx (root is an Element here).
    if (instanceCollector && Comp.handlers && root instanceof Element) {
      instanceCollector.push({ root, handlers: Comp.handlers, ctx: ctx as Record<string, unknown>, props });
    }
    return root;
  }
  // fallback — child not resumable (no adopt / no snapshot): clear its server DOM and re-mount (CSR island)
  clearBlock(start, end);
  const node: Node | null = mount();
  if (node) {
    const list: ChildNode[] = node instanceof DocumentFragment ? ([...node.childNodes] as ChildNode[]) : [node as ChildNode];
    for (const n of list) end.parentNode!.insertBefore(n, end);
  }
  return node;
}

/**
 * CREATE side (the resumable server render): insert an isolated dynamic text node before `anchor` and keep
 * it updated. The leading `<!--$-->` marker keeps the text a distinct node in the serialized HTML so the
 * client can {@link adoptText} exactly it — even when a static run precedes it in the same element.
 */
export function bindTextResumable(anchor: Comment, fn: () => unknown): void {
  const parent: Node = anchor.parentNode!;
  parent.insertBefore(document.createComment(DYN_TEXT), anchor); // isolation marker
  const t: Text = document.createTextNode('');
  parent.insertBefore(t, anchor);
  effect(() => {
    t.data = stringify(fn());
  });
}

/**
 * ADOPT side (the client): re-bind the dynamic text the server rendered before `anchor` — the existing text
 * node, reused in place (no node created, `setup` never re-run). The node is the anchor's previous sibling,
 * kept separate by its marker. If it is somehow absent (a non-resumable/mismatched render), one is created
 * so the binding still works rather than throwing.
 */
export function adoptText(anchor: Comment, fn: () => unknown): void {
  let t: Node | null = anchor.previousSibling;
  if (!t || t.nodeType !== 3 /* Text */) {
    // The server text node this binding was compiled to adopt is not there. Repairing keeps the page
    // working — deliberate, and the reason this does not throw: a mismatch should not blank a user's
    // page over one binding. But a mismatch also means the adopt walk's index arithmetic disagreed
    // with the DOM the server actually wrote, which is the failure mode this whole subsystem is most
    // prone to and the one that hides best. Silence made it undiagnosable, so it says so, once.
    warnAdoptRepair();
    t = document.createTextNode('');
    anchor.parentNode!.insertBefore(t, anchor);
  }
  const text: Text = t as Text;
  effect(() => {
    text.data = stringify(fn());
  });
}
