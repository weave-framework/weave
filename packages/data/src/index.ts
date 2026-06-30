/**
 * @weave-framework/data — signal-native async data. Zero third-party deps (native `fetch`).
 *
 * `resource(source, fetcher)` turns an async fetch into reactive `{ data, loading,
 * error }` signals: it refetches whenever `source` changes and cancels the
 * in-flight request (AbortController) on change or unmount — so you never wire up
 * loading flags or race-condition guards by hand. `createClient()` is an optional
 * thin wrapper over `fetch` (base URL, default headers, JSON, error hook) whose
 * methods drop straight into a resource fetcher.
 *
 * This is deliberately NOT an Angular-style HttpClient (no RxJS) — just the few
 * primitives an app actually needs, built on signals. It does ship a small
 * functional-interceptor chain (`(req, next) => Promise<Response>`), the zero-RxJS
 * analog of Angular's `HttpInterceptorFn`, for auth/logging/retry/caching.
 */

import { signal, effect, batch, onCleanup, watch } from '@weave-framework/runtime';
import type { Signal } from '@weave-framework/runtime';

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

  const data: Signal<unknown> = signal<unknown>(options.initialValue);
  const error: Signal<unknown> = signal<unknown>(undefined);
  const loading: Signal<boolean> = signal(false);

  // A plain counter signal the effect subscribes to, so refetch() can re-trigger
  // it even when `source` is unchanged.
  const trigger: Signal<number> = signal(0);
  let pendingRefetch: boolean = false;

  function load(value: unknown, refetching: boolean): void {
    const controller: AbortController = new AbortController();
    let cancelled: boolean = false;
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
    const value: unknown = source();
    const refetching: boolean = pendingRefetch;
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

/* ──────────────────────────── action ──────────────────────────── */

/** Reactive state for an async action (a form submit / mutation). */
export interface Action<I, T> {
  /** Run the action with `input`. Resolves/rejects with the action's own result. */
  run: (input: I) => Promise<T>;
  /** True while a run is in flight. Reactive. */
  pending: () => boolean;
  /** The last rejection, or undefined. Cleared at the start of each run. Reactive. */
  error: () => unknown;
  /** The latest resolved result, or undefined. Reactive. */
  result: () => T | undefined;
}

/**
 * Wrap an async action (submit / mutation) with reactive `pending`/`error`/`result`
 * — the write-side counterpart to `resource` (which is for reads). The Weave analog
 * of React's `useActionState`. If runs overlap, only the **latest** updates the
 * signals (a stale slow run can't clobber a newer one); every caller still gets its
 * own promise result back from `run`.
 */
export function action<I = void, T = unknown>(fn: (input: I) => Promise<T> | T): Action<I, T> {
  const pending: Signal<boolean> = signal(false);
  const error: Signal<unknown> = signal<unknown>(undefined);
  const result: Signal<T | undefined> = signal<T | undefined>(undefined);
  let runId: number = 0;

  async function run(input: I): Promise<T> {
    const id: number = ++runId;
    batch(() => {
      pending.set(true);
      error.set(() => undefined);
    });
    try {
      const value: T = await fn(input);
      if (id === runId) {
        batch(() => {
          result.set(() => value);
          pending.set(false);
        });
      }
      return value;
    } catch (err) {
      if (id === runId) {
        batch(() => {
          error.set(() => err);
          pending.set(false);
        });
      }
      throw err;
    }
  }

  return {
    run,
    pending: () => pending(),
    error: () => error(),
    result: () => result(),
  };
}

/* ──────────────────────────── optimistic ──────────────────────────── */

/** A base value with optimistic updates folded in until the real value reconciles. */
export interface Optimistic<T, U> {
  /** `base` with every in-flight optimistic update applied via the reducer. Reactive. */
  value: () => T;
  /** Push an optimistic update; cleared automatically when `base` next changes. */
  add: (optimistic: U) => void;
}

/**
 * Show an optimistic value over `base` while a mutation is in flight, reconciling
 * automatically when the real `base` changes — the Weave analog of React's
 * `useOptimistic`. `reduce` folds each pending update onto the current value
 * (default: replace). Must be called inside an owner (component `setup`) so its
 * internal watcher disposes on unmount.
 */
export function optimistic<T, U = T>(
  base: () => T,
  reduce: (current: T, optimistic: U) => T = (_, u) => u as unknown as T
): Optimistic<T, U> {
  const pending: Signal<U[]> = signal<U[]>([]);

  // When the real base changes (the mutation's result landed), drop the overlay.
  // `watch` fires on change only, never on creation — so the seed value is kept.
  watch(base, () => {
    pending.set([]);
  });

  return {
    value: () => pending().reduce((acc, u) => reduce(acc, u), base()),
    add: (u) => pending.set((list) => [...list, u]),
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

/**
 * A mutable request descriptor passed down the interceptor chain. Mutate it
 * in place (`req.headers.set(…)`) or hand `next` a fresh one — both work.
 */
export interface WeaveRequest {
  /** Fully-resolved URL (baseUrl + path + query string). */
  url: string;
  method: string;
  /** Mutable headers — set/append before calling `next`. */
  headers: Headers;
  body: BodyInit | null;
  /** The remaining `RequestInit` fields (signal, credentials, mode, …). */
  init: RequestInit;
}

/** Performs the request (the next interceptor, or finally the real `fetch`). */
export type RequestHandler = (req: WeaveRequest) => Promise<Response>;

/**
 * A functional interceptor — the zero-RxJS analog of Angular's `HttpInterceptorFn`.
 * Wrap `next(req)` to read/replace the request, inspect or retry the response, or
 * short-circuit (return a `Response` without calling `next`). Interceptors run in
 * the order given; the first is outermost.
 */
export type Interceptor = (req: WeaveRequest, next: RequestHandler) => Promise<Response>;

export interface ClientOptions {
  /** Prepended to every request path. */
  baseUrl?: string;
  /** Default headers, or a function called per request (e.g. for a fresh auth token). */
  headers?: HeadersInit | (() => HeadersInit);
  /** Called with any thrown error before it is re-thrown (logging / global handling). */
  onError?: (error: unknown) => void;
  /** Functional interceptor chain (auth/logging/retry/cache). First = outermost. */
  interceptors?: Interceptor[];
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
  const doFetch: typeof fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base: string = options.baseUrl ?? '';

  // The terminal handler actually hits the network; interceptors wrap around it
  // (composed once, outermost-first). reduceRight folds the chain so the first
  // interceptor sees `next` = the rest of the chain ending in `doFetch`.
  const terminal: RequestHandler = (req) =>
    doFetch(req.url, { method: req.method, headers: req.headers, body: req.body, ...req.init });
  const handler: RequestHandler = (options.interceptors ?? []).reduceRight<RequestHandler>(
    (next, interceptor) => (req) => interceptor(req, next),
    terminal
  );

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { json, params, headers, body, ...rest } = opts;

    let url: string = base + path;
    if (params) {
      const qs: URLSearchParams = new URLSearchParams();
      for (const k in params) qs.set(k, String(params[k]));
      url += (url.includes('?') ? '&' : '?') + qs.toString();
    }

    const defaults: HeadersInit | undefined =
      typeof options.headers === 'function' ? options.headers() : options.headers;
    const h: Headers = new Headers(defaults);
    if (headers) new Headers(headers).forEach((v, k) => h.set(k, v));

    let finalBody: BodyInit | null = body ?? null;
    if (json !== undefined) {
      finalBody = JSON.stringify(json);
      if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
    }

    const req: WeaveRequest = { url, method, headers: h, body: finalBody, init: rest };
    try {
      // The chain returns the raw Response (including non-2xx) so an interceptor
      // can inspect/retry it; the ok-check + parse stay here, outside the chain.
      const res: Response = await handler(req);
      if (!res.ok) throw new HttpError(res.status, res.statusText, res);
      const ct: string = res.headers.get('content-type') ?? '';
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
