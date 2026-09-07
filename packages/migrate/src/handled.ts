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
