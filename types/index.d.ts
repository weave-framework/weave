// Weave — TypeScript definitions.
// Type-safe by inference, zero decorators, zero ceremony.

/** A readable + writable reactive value. Call it to read (and subscribe). */
export interface Signal<T> {
  /** Read the current value and subscribe the active computation. */
  (): T;
  /** Write a new value, or derive it from the previous one. */
  set(next: T | ((prev: T) => T)): T;
  /** Alias for `set` with an updater. */
  update(fn: (prev: T) => T): T;
  /** Read without subscribing. */
  peek(): T;
}

/** A cached derived value. Read-only. */
export type Computed<T> = () => T;

export function signal<T>(initial: T, opts?: { equals?: (a: T, b: T) => boolean }): Signal<T>;
export function computed<T>(fn: () => T, opts?: { equals?: (a: T, b: T) => boolean }): Computed<T>;
export function effect(fn: () => void | (() => void)): () => void;
export function batch<T>(fn: () => T): T;
export function untrack<T>(fn: () => T): T;
export function onCleanup(fn: () => void): void;

/** Tagged template that binds signals to real DOM. No Virtual DOM. */
export function html(strings: TemplateStringsArray, ...values: any[]): DocumentFragment;

export function when(
  cond: boolean | (() => any),
  then: () => any,
  otherwise?: () => any
): () => any;

export function each<T>(
  items: T[] | (() => T[]),
  render: (item: T, index: number) => any,
  key?: (item: T, index: number) => unknown
): () => Node[];

export function mount(view: DocumentFragment | Node | (() => any), container: Element): () => void;

export function component<P extends object>(render: (props: P) => any): (props?: P) => any;
export function onMount(fn: () => void | (() => void)): void;

export interface Context<T> {
  provide<R>(value: T, fn: () => R): R;
  use(): T;
}
export function createContext<T>(defaultValue?: T): Context<T>;

export function store<T>(factory: () => T): () => T;

export function router(routes: Record<string, (params: any) => any>): () => any;
export function link(to: string, children: any, attrs?: Record<string, string>): HTMLAnchorElement;
export function navigate(to: string): void;
export const currentPath: Signal<string>;
