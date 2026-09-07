/**
 * What the converter can do about a class it did not write — and, far more often, what it cannot.
 *
 * A selection's real cost is not the files it moves; it is the injected classes behind them that have no
 * source of ours. Measured on one real application: 27 such classes, of which the converter rewrites TWO.
 * The other 25 land in the generated code exactly as they were, against imports that no longer exist, and
 * the reader finds out when the build fails. Saying so before anything is written is the whole point of
 * the step this table serves.
 *
 * The names here are duplicated from `packages/cli/src/migrate-convert.ts` rather than imported: the UI is
 * a separate bundle and the CLI is not among its dependencies. Duplication of a fact is a promise to keep
 * it true, so `verify:migrate-handled` reads the converter's own tables and fails when the two drift —
 * which is what stops this from quietly becoming a lie the first time the converter learns a third name.
 */

/** How much of the work is already done for one outside class. */
export type Handled =
  /** The converter rewrites the calls. Nothing to decide. */
  | 'automatic'
  /** Weave has the same thing, but the converter only maps the TEMPLATE form. Injected, it is left alone. */
  | 'template-only'
  /** Workspace code the walk failed to open — a defect here, not a fact about the application. */
  | 'unread'
  /** No mapping and none possible without being told what it should become. */
  | 'none';

/**
 * Injected classes whose calls the converter rewrites on its own.
 *
 * Mirrors `SERVICE_METHODS` in the converter. Two entries, and the number matters: it is the honest
 * denominator behind every "the tool handles it" assumption a reader might otherwise make.
 */
export const CONVERTED: Record<string, string> = {
  Router: '`navigate(…)` from `@weave-framework/router`',
  HttpClient: '`createClient(…)` from `@weave-framework/data`',
};

/**
 * Angular Material classes Weave matches, but only where they appear as MARKUP.
 *
 * Mirrors the tag table in the converter. `<mat-dialog>` becomes `openDialog(…)`; `MatDialog` injected into
 * a constructor does not, because the call sites are code the converter does not rewrite. Reporting these
 * as handled would be the most tempting error available — the equivalent exists, so it reads as done.
 *
 * Two entries were written here from memory on the first attempt — `MatDialogRef` and `MAT_DIALOG_DATA`, both
 * plausible, neither known to the converter. The gate caught them on its first run. Only names the converter
 * actually carries belong here; anything else is a note about what SHOULD happen, printed as though it does.
 */
export const TEMPLATE_ONLY: Record<string, string> = {
  MatDialog: '`openDialog(…)` from `@weave-framework/ui/dialog` — mapped in markup, not where it is injected',
  MatSnackBar: '`snackbar(…)` from `@weave-framework/ui/snackbar` — mapped in markup, not where it is injected',
};

/** What the converter will manage for one outside class, given the library it was traced to. */
export function handledFor(name: string, library: string | undefined): Handled {
  if (CONVERTED[name]) return 'automatic';
  if (TEMPLATE_ONLY[name]) return 'template-only';
  // No library traced means the walk never opened the file, not that the class came from nowhere.
  if (!library) return 'unread';
  return 'none';
}

/** The one-line explanation shown beside a class, or an empty string when there is nothing to add. */
export function handledNote(name: string): string {
  return CONVERTED[name] ?? TEMPLATE_ONLY[name] ?? '';
}

/* ─────────────────────────── what it could become ─────────────────────────── */

/**
 * How a Weave name is reached, which decides both how the line reads and how the gate checks it.
 *
 * The last three carry no package on purpose: `ref={{ el }}` is template syntax, `document` is the platform,
 * and two of these classes have no replacement because the machinery they served does not exist here.
 */
export type Shape = 'function' | 'type' | 'component' | 'template' | 'global' | 'gone';

/** What one Angular class could become, and how sure that is. */
export interface Suggestion {
  /** The Weave name, exactly as it is exported. Empty when the honest answer is that it disappears. */
  symbol: string;
  /** Where it is imported from. Empty for template syntax, a platform global, or nothing at all. */
  from: string;
  shape: Shape;
  /** Why, in one line the reader can act on. */
  why: string;
  /** `certain` where the mapping is settled; `likely` where it is a reading of the intent. */
  sure: 'certain' | 'likely';
}

/**
 * The Weave answer for an injected Angular class — a suggestion, never a rewrite.
 *
 * Asked for by the reader, whose own words were "I suspect this is impossible". It is not: of the 27 outside
 * classes in one real application, 19 have something to point at. Two of those answers are that the class
 * DISAPPEARS — Weave has neither change detection nor zones — and saying so matters more than the rest,
 * because the alternative is a reader hunting for a replacement that should not exist.
 *
 * Every `symbol` here is looked up in the real package by `verify:migrate-consequence` before it is allowed
 * to ship. A suggestion naming an API that does not exist is worse than no suggestion: it sends someone to
 * write an import that cannot resolve, on the authority of a tool that sounded certain.
 */
export const SUGGESTS: Record<string, Suggestion> = {
  /* ── settled ──
     `Router` and `HttpClient` are deliberately absent: the converter rewrites them, `CONVERTED` says so, and a
     class in both tables would have the screen print the same answer twice under two different headings. The
     gate keeps the two disjoint. */
  TranslateService: { symbol: 't', from: '@weave-framework/i18n', shape: 'function', sure: 'certain',
    why: 'translation is a function call, not an injected service — the converter already rewrites the `| translate` pipe this way' },
  ActivatedRoute: { symbol: 'currentPath', from: '@weave-framework/router', shape: 'function', sure: 'certain',
    why: 'the path and query are signals — read them where you need them, with `currentQuery` alongside' },
  Location: { symbol: 'back', from: '@weave-framework/router', shape: 'function', sure: 'certain',
    why: 'history navigation is a function on the router' },
  MatSnackBar: { symbol: 'snackbar', from: '@weave-framework/ui/snackbar', shape: 'function', sure: 'certain',
    why: 'called, not injected and not placed in markup' },
  MatDialog: { symbol: 'openDialog', from: '@weave-framework/ui/dialog', shape: 'function', sure: 'certain',
    why: 'a dialog is opened by a call that hosts a component' },
  MatMenuTrigger: { symbol: 'menu', from: '@weave-framework/ui/menu', shape: 'function', sure: 'certain',
    why: 'the menu is attached to a trigger element rather than injected' },
  ElementRef: { symbol: 'ref={{ el }}', from: '', shape: 'template', sure: 'certain',
    why: 'the element arrives through a template binding — there is nothing to inject' },
  DOCUMENT: { symbol: 'document', from: '', shape: 'global', sure: 'certain',
    why: 'Weave has no document token; use the platform global' },

  /* ── a reading of the intent, not a settled mapping ── */
  MatDialogRef: { symbol: 'DialogRef', from: '@weave-framework/ui/dialog', shape: 'type', sure: 'likely',
    why: 'the handle `openDialog` returns — held by the opener, not injected into the opened component' },
  MAT_DIALOG_DATA: { symbol: 'props', from: '', shape: 'template', sure: 'likely',
    why: 'dialog data reaches the hosted component as ordinary props' },
  Injector: { symbol: 'inject', from: '@weave-framework/runtime', shape: 'function', sure: 'likely',
    why: 'reaching for a dependency at runtime is `inject` against a context' },
  HttpBackend: { symbol: 'createClient', from: '@weave-framework/data', shape: 'function', sure: 'likely',
    why: 'the interceptor layer it existed to bypass is client configuration here' },
  Title: { symbol: 'document.title', from: '', shape: 'global', sure: 'likely',
    why: 'there is no title service; set it where the route changes' },
  ToastPackage: { symbol: 'snackbar', from: '@weave-framework/ui/snackbar', shape: 'function', sure: 'likely',
    why: 'the toast body it configures is the snackbar call' },
  PaginatePipe: { symbol: 'Paginator', from: '@weave-framework/ui/paginator', shape: 'component', sure: 'likely',
    why: 'paging is a component with a page event, not a pipe over the list' },

  /* ── the answer is that it goes away ──
     The most useful two entries in the table. Left out, a reader searches for a replacement, finds none, and
     concludes the migration is blocked on something that simply has no counterpart here. */
  ChangeDetectorRef: { symbol: '', from: '', shape: 'gone', sure: 'certain',
    why: 'nothing replaces it — Weave has no change detection to mark dirty; a signal write updates its own DOM' },
  NgZone: { symbol: '', from: '', shape: 'gone', sure: 'certain',
    why: 'nothing replaces it — Weave has no zones, so there is nothing to run inside or outside of' },
};

/** What this class could become, or `undefined` when nothing honest can be said. */
export function suggestFor(name: string): Suggestion | undefined {
  return SUGGESTS[name];
}
