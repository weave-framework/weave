/**
 * @weave/data — signal-native async data. Zero third-party deps (native `fetch`).
 *
 * `resource(source, fetcher)` turns an async fetch into reactive `{ data, loading,
 * error }` signals: it refetches whenever `source` changes and cancels the
 * in-flight request (AbortController) on change or unmount — so you never wire up
 * loading flags or race-condition guards by hand. `createClient()` is an optional
 * thin wrapper over `fetch` (base URL, default headers, JSON, error hook) whose
 * methods drop straight into a resource fetcher.
 *
 * This is deliberately NOT an Angular-style HttpClient (no RxJS, no interceptor
 * chain) — just the few primitives an app actually needs, built on signals.
 */

import { signal, effect, batch, onCleanup } from '@weave/runtime';

/* ──────────────────────────── resource ──────────────────────────── */

/** Extra info handed to a fetcher: an abort signal + whether this is a manual refetch. */
export interface FetchInfo {
  signal: AbortSignal;
  refetching: boolean;
}

/** Produces the data for a resource. Gets the (non-null) source value + abort info. */
export type Fetcher<S, T> = (value: S, info: FetchInfo) => Promise<T> | T;

export interface ResourceOptions<T> {
  /** Seed value before the first fetch resolves (data() returns this meanwhile). */
  initialValue?: T;
}

/** Reactive view of an async value. All accessors are signals — call them to read. */
export interface Resource<T> {
  /** Latest resolved value, or the initial/undefined value while pending. Reactive. */
  data: () => T | undefined;
  /** True while a fetch is in flight. Reactive. */
  loading: () => boolean;
  /** The last rejection, or undefined. Cleared at the start of each fetch. Reactive. */
  error: () => unknown;
  /** Re-run the fetcher with the current source (info.refetching = true). */
  refetch: () => void;
  /** Set `data` directly without fetching (optimistic update / cache write). */
  mutate: (value: T | undefined) => void;
}

/** A source value of `undefined | null | false` means "not ready" — the fetcher is skipped. */
type SourceValue<S> = S | undefined | null | false;

export function resource<T>(fetcher: Fetcher<true, T>, options?: ResourceOptions<T>): Resource<T>;
export function resource<S, T>(
  source: () => SourceValue<S>,
  fetcher: Fetcher<S, T>,
  options?: ResourceOptions<T>
): Resource<T>;
export function resource(
  a: (() => unknown) | Fetcher<any, unknown>,
  b?: Fetcher<any, unknown> | ResourceOptions<unknown>,
  c?: ResourceOptions<unknown>
): Resource<unknown> {
  // Two shapes: resource(fetcher, opts?) or resource(source, fetcher, opts?).
  let source: () => unknown;
  let fetcher: Fetcher<unknown, unknown>;
  let options: ResourceOptions<unknown>;
  if (typeof b === 'function') {
    source = a as () => unknown;
    fetcher = b;
    options = c ?? {};
  } else {
    source = () => true;
    fetcher = a as Fetcher<unknown, unknown>;
    options = (b as ResourceOptions<unknown>) ?? {};
  }

  const data = signal<unknown>(options.initialValue);
  const error = signal<unknown>(undefined);
  const loading = signal(false);

  // A plain counter signal the effect subscribes to, so refetch() can re-trigger
  // it even when `source` is unchanged.
  const trigger = signal(0);
  let pendingRefetch = false;

  function load(value: unknown, refetching: boolean): void {
    const controller = new AbortController();
    let cancelled = false;
    // Registered on the owning effect's computation, so the next re-run (source
    // change / refetch) or unmount aborts this in-flight request.
    onCleanup(() => {
      cancelled = true;
      controller.abort();
    });

    batch(() => {
      loading.set(true);
      error.set(() => undefined);
    });

    // Defer the fetcher to a microtask so it never tracks signals in this effect.
    Promise.resolve()
      .then(() => fetcher(value, { signal: controller.signal, refetching }))
      .then(
        (result) => {
          if (cancelled) return;
          batch(() => {
            data.set(() => result);
            loading.set(false);
          });
        },
        (err) => {
          // An abort is an intentional cancel, not an error to surface.
          if (cancelled || (err && (err as { name?: string }).name === 'AbortError')) return;
          batch(() => {
            error.set(() => err);
            loading.set(false);
          });
        }
      );
  }

  effect(() => {
    trigger(); // subscribe so refetch() re-runs this
    const value = source();
    const refetching = pendingRefetch;
    pendingRefetch = false;
    if (value === undefined || value === null || value === false) {
      loading.set(false); // not ready — keep last data, ensure not stuck loading
      return;
    }
    load(value, refetching);
  });

  return {
    data: () => data(),
    loading: () => loading(),
    error: () => error(),
    refetch: () => {
      pendingRefetch = true;
      trigger.set((n) => n + 1);
    },
    mutate: (value) => data.set(() => value),
  };
}

/* ──────────────────────────── createClient ──────────────────────────── */

/** Thrown when a response has a non-2xx status. Carries the raw `Response`. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public response: Response
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'HttpError';
  }
}

export interface ClientOptions {
  /** Prepended to every request path. */
  baseUrl?: string;
  /** Default headers, or a function called per request (e.g. for a fresh auth token). */
  headers?: HeadersInit | (() => HeadersInit);
  /** Called with any thrown error before it is re-thrown (logging / global handling). */
  onError?: (error: unknown) => void;
  /** Override the fetch implementation (tests / SSR). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  /** Body shortcut: JSON-stringified, with `Content-Type: application/json` set. */
  json?: unknown;
  /** Raw body (use instead of `json` for FormData / text / blobs). */
  body?: BodyInit | null;
  /** Query parameters appended to the URL. */
  params?: Record<string, string | number | boolean>;
}

export interface Client {
  request<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
}

/** Create a small fetch client. Its methods are ready-made resource fetchers. */
export function createClient(options: ClientOptions = {}): Client {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl ?? '';

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { json, params, headers, body, ...rest } = opts;

    let url = base + path;
    if (params) {
      const qs = new URLSearchParams();
      for (const k in params) qs.set(k, String(params[k]));
      url += (url.includes('?') ? '&' : '?') + qs.toString();
    }

    const defaults = typeof options.headers === 'function' ? options.headers() : options.headers;
    const h = new Headers(defaults);
    if (headers) new Headers(headers).forEach((v, k) => h.set(k, v));

    let finalBody = body ?? null;
    if (json !== undefined) {
      finalBody = JSON.stringify(json);
      if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
    }

    try {
      const res = await doFetch(url, { method, headers: h, body: finalBody, ...rest });
      if (!res.ok) throw new HttpError(res.status, res.statusText, res);
      const ct = res.headers.get('content-type') ?? '';
      return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
    } catch (err) {
      options.onError?.(err);
      throw err;
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, json: body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, json: body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, json: body }),
    delete: (path, opts) => request('DELETE', path, opts),
  };
}
