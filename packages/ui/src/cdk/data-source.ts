/**
 * DataSource — the collection-viewer contract a Table/Tree consumes so paging, sorting,
 * filtering and virtualization can be swapped underneath without the component knowing.
 * A component calls `connect()` to get a **read-only signal of the rows to render** and
 * `disconnect()` to release resources; the concrete source (a static array, a signal, a
 * paged fetcher…) lives behind the interface. Signal-native and zero-dep.
 *
 *   const ds = new ArrayDataSource(rows);          // rows: T[] | Signal<T[]>
 *   const view = ds.connect();                     // () => T[] (reactive, read-only)
 *   effect(() => render(view()));
 *   // …later: ds.disconnect();
 */

import { type Computed, type Signal } from '@weave-framework/runtime';

/** The window of rows a viewer currently needs (drives virtual scroll). All optional. */
export interface CollectionViewer {
  /** The rendered index range the viewer needs, as a signal — for virtual scrolling. */
  viewChange?: Computed<{ start: number; end: number }>;
}

export interface DataSource<T> {
  /** Connect a viewer; returns a read-only reactive signal of the rows to render. */
  connect(viewer?: CollectionViewer): Computed<T[]>;
  /** Disconnect the viewer and release any resources held for it. */
  disconnect(viewer?: CollectionViewer): void;
}

/**
 * The trivial concrete DataSource — wraps a static array OR a signal/getter of rows. When
 * given a signal, reactive updates propagate straight through `connect()`.
 */
export class ArrayDataSource<T> implements DataSource<T> {
  private readonly view: Computed<T[]>;

  constructor(source: T[] | Computed<T[]> | Signal<T[]>) {
    this.view = typeof source === 'function' ? source : (): T[] => source;
  }

  connect(): Computed<T[]> {
    return this.view;
  }

  disconnect(): void {
    // No resources held — the source is either a plain array or a caller-owned signal.
  }
}

/** True when `value` implements the DataSource contract (vs a plain array/signal). */
export function isDataSource<T>(value: unknown): value is DataSource<T> {
  return (
    value != null &&
    typeof (value as DataSource<T>).connect === 'function' &&
    typeof (value as DataSource<T>).disconnect === 'function'
  );
}
