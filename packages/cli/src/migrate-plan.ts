/**
 * `weave migrate` — the PLAN writer (RFC 0011, M3). It turns the analyzer's facts map into `migration-plan.md`:
 * a human-readable account of what was found, what becomes Weave mechanically, what needs a human, in what order
 * to convert, and — first-class — everything the tool could NOT see.
 *
 * Where it sits: `migrate-analyze.ts` MEASURES (facts, no opinions) → this module REASONS over those facts to
 * produce the plan → M4 converts. It is deliberately pure: facts in, markdown string out, so it is testable
 * without touching disk, and every framework module can reuse it (the Angular→Weave mapping knowledge is the one
 * framework-specific part — a React module supplies its own `MAPPING` table and reuses the rest).
 *
 * Two rules shape every line it writes:
 *   • The plan is written BEFORE any conversion, so the user reads it and there are no surprises.
 *   • Anything unseen is stated plainly ("can't see clearly"), never filled with a silent guess.
 *
 * Zero third-party deps — string building only (plus one `writeFileSync` to put the plan on disk).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BranchFact,
  Coverage,
  ComponentFact,
  FormFact,
  MigrationFacts,
  PackagePlan,
  RouteFact,
  ServiceFact,
} from './migrate-analyze.js';

/** How much human judgement a piece needs. `auto` = mechanical; `needs-you` = a real decision to make. */
export type Effort = 'auto' | 'needs-you';

/** One piece of work in the plan, in convert order. */
export interface PlanItem {
  /** `component` / `service` / `route` / `form` / `package`. */
  kind: string;
  /** The thing's name (class, selector, path, package). */
  name: string;
  effort: Effort;
  /** What it becomes in Weave, or what the human must decide. */
  note: string;
}

/* ──────────── the Angular → Weave mapping knowledge (the ONE framework-specific part) ──────────── */

/** `@angular/*` entry points → what they become. Used for the plan's "what changes" table. */
const ANGULAR_MAP: Array<{ match: (spec: string) => boolean; becomes: string }> = [
  { match: (s) => s === '@angular/core', becomes: 'Weave component `setup()` + signals (`signal`/`computed`/`effect`)' },
  { match: (s) => s === '@angular/common', becomes: 'template control flow — `@if` / `@for` / `@switch`' },
  { match: (s) => s === '@angular/common/http', becomes: '`@weave-framework/data` — `createClient` / `resource` / `action`' },
  { match: (s) => s === '@angular/forms', becomes: '`@weave-framework/forms` — `field` / `form` / `group` / `validators`' },
  { match: (s) => s === '@angular/router', becomes: '`@weave-framework/router` — `route()` / `<RouterView>` / `beforeEach`' },
  { match: (s) => s === '@angular/platform-browser', becomes: 'the Weave bootstrap (`mount`) — no direct equal needed' },
  { match: (s) => s === '@angular/core/rxjs-interop', becomes: '`fromObservable`/`toObservable`; `takeUntilDestroyed` → the owner\'s `onDispose` cleanup' },
  { match: (s) => s.startsWith('@angular/animations'), becomes: 'template transitions (`transition:`) — **needs you**' },
];

/** What one `@angular/*` import becomes, or an honest "no direct mapping — needs you". */
export function angularBecomes(spec: string): string {
  for (const m of ANGULAR_MAP) if (m.match(spec)) return m.becomes;
  return 'no direct mapping recorded — **needs you**';
}

/* ──────────── effort: which pieces are mechanical, and which need a human ──────────── */

/** The packages whose presence in a file makes its conversion a judgement call (reactivity has to be rethought). */
const HARD_PACKAGES: string[] = ['rxjs'];

/** Files that import a "hard" package — their components/services need human eyes on the reactivity. */
function hardFiles(facts: MigrationFacts): Set<string> {
  const out: Set<string> = new Set<string>();
  for (const u of facts.packageUsage) {
    if (HARD_PACKAGES.includes(u.name)) for (const s of u.sites) out.add(s);
  }
  return out;
}

/** A component is mechanical unless it carries RxJS (reactivity to rethink) or heavy branching to preserve. */
function componentItem(cf: ComponentFact, hard: Set<string>, branches: BranchFact[]): PlanItem {
  const name: string = cf.selector ?? cf.className;
  const io: string = `${cf.inputs.length} input(s) → props, ${cf.outputs.length} output(s) → \`on:\``;
  const tpl: string = cf.templateInline ? 'inline template → sibling `.html`' : `template \`${cf.templateUrl ?? '?'}\``;
  if (hard.has(cf.file)) {
    return { kind: 'component', name, effort: 'needs-you', note: `${io}; ${tpl}. Uses RxJS — its reactivity becomes signals; review each stream.` };
  }
  const branchy: BranchFact | undefined = branches.find((b) => b.method.startsWith(`${cf.className}.`));
  const extra: string = branchy ? ' Has conditional logic — its branches must be preserved.' : '';
  return { kind: 'component', name, effort: 'auto', note: `${io}; ${tpl}.${extra}` };
}

/** A `providedIn:'root'` service maps to `store()`; a scoped one to `provide`/`inject`; RxJS makes it a judgement call. */
function serviceItem(sf: ServiceFact, hard: Set<string>): PlanItem {
  const target: string = sf.providedIn === 'root' ? '`store()` (a singleton)' : '`provide`/`inject` (scoped — it has no `providedIn`)';
  const deps: string = sf.injects.length ? ` Injects ${sf.injects.join(', ')}.` : '';
  // A service's surface is methods AND fields — several real services expose only a signal, which would read as
  // "0 public API" if methods were counted alone. Signals are called out: they map to Weave signals one-to-one.
  const surface: string[] = [`${sf.methods.length} public method(s)`];
  if (sf.fields.length) surface.push(`${sf.fields.length} public field(s)`);
  if (sf.signals.length) surface.push(`${sf.signals.length} already a signal (${sf.signals.join(', ')}) → maps 1:1 to a Weave signal`);
  const api: string = surface.join(', ');
  if (hard.has(sf.file)) {
    return { kind: 'service', name: sf.className, effort: 'needs-you', note: `→ ${target}. ${api}.${deps} Uses RxJS — streams become signals/\`resource\`; review each.` };
  }
  return { kind: 'service', name: sf.className, effort: 'auto', note: `→ ${target}. ${api}.${deps}` };
}

/** A guarded route needs a `beforeEach` decision; a plain one is mechanical. */
function routeItem(rf: RouteFact): PlanItem {
  const path: string = rf.path === '' ? "'' (default)" : (rf.path ?? '(no path)');
  const bits: string[] = [];
  if (rf.component) bits.push(`→ ${rf.component}`);
  if (rf.redirectTo !== null) bits.push(`redirects to '${rf.redirectTo}'`);
  if (rf.lazy) bits.push('lazy — becomes a dynamic `import()`');
  if (rf.guards.length) {
    bits.push(`guards: ${rf.guards.join(', ')} → \`beforeEach\``);
    return { kind: 'route', name: path, effort: 'needs-you', note: `${bits.join('; ')}. A guard's logic must be re-expressed — check what it reads.` };
  }
  return { kind: 'route', name: path, effort: 'auto', note: bits.join('; ') || 'a plain route' };
}

/** Reactive forms always get human eyes — validators and async checks rarely map one-to-one. */
function formItem(ff: FormFact): PlanItem {
  const where: string = ff.className ?? ff.file;
  return {
    kind: 'form',
    name: where,
    effort: 'needs-you',
    note: `${ff.controls.length} control(s) (${ff.controls.join(', ') || 'unread'}) → \`@weave-framework/forms\` \`field\`/\`group\`. Check validators, async checks, and submit.`,
  };
}

/** A package's plan line: `auto` is mechanical, `try` is the user's call, `keep` is no work at all. */
function packageItem(pp: PackagePlan, sites: number): PlanItem {
  const where: string = sites ? ` Used in ${sites} file(s).` : '';
  if (pp.decision === 'auto') return { kind: 'package', name: pp.name, effort: 'auto', note: `${pp.note}.${where}` };
  if (pp.decision === 'keep') return { kind: 'package', name: pp.name, effort: 'auto', note: `Kept as-is — ${pp.note}.${where}` };
  return { kind: 'package', name: pp.name, effort: 'needs-you', note: `${pp.note}.${where}` };
}

/* ──────────── convert order: leaves first (bottom-up) ──────────── */

/**
 * Order the classes bottom-up from the DI graph: something that injects nothing converts first, and nothing
 * converts before what it depends on. A dependency cycle can't be ordered — its members are appended at the end
 * and REPORTED (never silently broken). Classes outside the graph are leaves and come first.
 */
export function convertOrder(facts: MigrationFacts): string[] {
  const deps: Map<string, Set<string>> = new Map<string, Set<string>>();
  const known: Set<string> = new Set<string>([...facts.services.map((s) => s.className), ...facts.components.map((c) => c.className)]);
  for (const cls of known) deps.set(cls, new Set<string>());
  for (const e of facts.di) {
    if (known.has(e.from) && known.has(e.to)) deps.get(e.from)?.add(e.to); // only edges INSIDE this unit can be ordered
  }
  const ordered: string[] = [];
  const done: Set<string> = new Set<string>();
  // Repeatedly take every class whose dependencies are all already ordered (a stable topological sweep).
  for (let pass: number = 0; pass < known.size + 1 && done.size < known.size; pass++) {
    for (const cls of [...known].sort()) {
      if (done.has(cls)) continue;
      const need: Set<string> = deps.get(cls) ?? new Set<string>();
      if ([...need].every((d) => done.has(d))) {
        ordered.push(cls);
        done.add(cls);
      }
    }
  }
  for (const cls of [...known].sort()) if (!done.has(cls)) ordered.push(cls); // cycle members — reported in the plan
  return ordered;
}

/* ──────────── the plan itself ──────────── */

/** Every plan item, in convert order (leaves first), across all the fact kinds. */
export function planItems(facts: MigrationFacts): PlanItem[] {
  const hard: Set<string> = hardFiles(facts);
  const order: string[] = convertOrder(facts);
  const rank = (cls: string): number => {
    const i: number = order.indexOf(cls);
    return i === -1 ? order.length : i;
  };
  const usageOf = (name: string): number => facts.packageUsage.find((u) => u.name === name)?.count ?? 0;

  const services: PlanItem[] = [...facts.services].sort((x, y) => rank(x.className) - rank(y.className)).map((s) => serviceItem(s, hard));
  const components: PlanItem[] = [...facts.components].sort((x, y) => rank(x.className) - rank(y.className)).map((cf) => componentItem(cf, hard, facts.branches));
  return [
    ...facts.packages.map((p) => packageItem(p, usageOf(p.name))),
    ...services, // services first: a component that injects one converts after it
    ...components,
    ...facts.routes.map(routeItem),
    ...facts.forms.map(formItem),
  ];
}

/** A markdown table, or a plain "(none)" line when there is nothing to show. */
function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_(none found)_\n';
  const head: string = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n`;
  return head + rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n';
}

/** Escape a cell's pipes so a value never breaks the table. */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/**
 * Render the whole `migration-plan.md` from a facts map. Sections, in the order a reader needs them: what this is
 * → summary → convert order → the per-piece plans (packages, services, components, routes, forms) → what the tool
 * could not see. Pure: no disk access, so it is fully testable.
 */
export function renderPlan(facts: MigrationFacts): string {
  const items: PlanItem[] = planItems(facts);
  const auto: number = items.filter((i) => i.effort === 'auto').length;
  const needs: number = items.filter((i) => i.effort === 'needs-you').length;
  const badge = (e: Effort): string => (e === 'auto' ? 'auto' : '**needs you**');
  const out: string[] = [];

  out.push('# Migration plan\n');
  out.push(`Generated by \`weave migrate\` for \`${facts.unit}\`.\n`);
  out.push(
    'This plan is written **before** anything is converted, so there are no surprises. It is an assisted migration, ' +
      '**not a 100% automatic** one: everything marked _needs you_ is a real decision, and the last section lists ' +
      "everything the tool could **not** see. Raw measurements live in `.weave-migrate/facts.json`.\n",
  );

  // Coverage comes FIRST, before any encouraging counts. Every gap in this tool so far was found by a person
  // asking "are we done?", never by the tool volunteering it — so it now volunteers it, at the top.
  const cov: Coverage = facts.coverage ?? { total: 0, handled: 0, gaps: [], emptyFiles: [] };
  const pct: number = cov.total ? Math.round((cov.handled / cov.total) * 100) : 0;
  out.push('## What this tool converts — and what it does not\n');
  out.push(`It converts **${cov.handled} of ${cov.total}** top-level declarations (**${pct}%**). The rest is listed here so nothing is a surprise later.\n`);
  if (cov.gaps.length) {
    out.push(
      table(
        ['Not converted', 'Count', 'What to do'],
        cov.gaps.map((g) => [cell(g.kind), String(g.count), cell(`${g.note} — ${g.names.slice(0, 6).join(', ')}${g.names.length > 6 ? ', …' : ''}`)]),
      ),
    );
  } else {
    out.push('_Everything found is converted._\n');
  }
  if (cov.emptyFiles.length) {
    out.push(`\n**${cov.emptyFiles.length} file(s) produce no output at all** — port these by hand:\n`);
    for (const f of cov.emptyFiles) out.push(`- \`${f}\``);
    out.push('');
  }

  out.push('\n## Summary\n');
  out.push(
    table(
      ['What', 'Count'],
      [
        ['Source files', String(facts.files.length)],
        ['Components', String(facts.components.length)],
        ['Services', String(facts.services.length)],
        ['Routes', String(facts.routes.length)],
        ['Reactive forms', String(facts.forms.length)],
        ['Third-party packages', String(facts.packages.length)],
        ['Your own workspace libs', String(facts.internal.length)],
        ['Pieces that convert mechanically', String(auto)],
        ['Pieces that need you', String(needs)],
      ],
    ),
  );

  if (facts.internal.length) {
    out.push('\n### Your own libraries\n');
    out.push('This unit depends on your own workspace libraries. Each one is its own migration — run `weave migrate` on it separately:\n');
    for (const i of facts.internal) out.push(`- \`${i}\``);
    out.push('');
  }

  out.push('\n## What the Angular pieces become\n');
  out.push(table(['Angular', '→ Weave'], facts.angular.map((s) => [cell(`\`${s}\``), cell(angularBecomes(s))])));

  out.push('\n## Convert in this order\n');
  out.push('Bottom-up — nothing converts before what it depends on:\n');
  const order: string[] = convertOrder(facts);
  out.push(order.length ? order.map((cls, i) => `${i + 1}. \`${cls}\``).join('\n') + '\n' : '_(nothing to order)_\n');

  out.push('\n## Third-party packages\n');
  out.push(
    table(
      ['Package', 'Decision', 'Notes'],
      facts.packages.map((p) => {
        const sites: number = facts.packageUsage.find((u) => u.name === p.name)?.count ?? 0;
        return [cell(`\`${p.name}\``), p.decision, cell(`${p.note}${sites ? ` (used in ${sites} file(s))` : ''}`)];
      }),
    ),
  );

  out.push('\n## Services\n');
  out.push(table(['Service', 'Effort', 'Plan'], items.filter((i) => i.kind === 'service').map((i) => [cell(`\`${i.name}\``), badge(i.effort), cell(i.note)])));

  out.push('\n## Components\n');
  out.push(table(['Component', 'Effort', 'Plan'], items.filter((i) => i.kind === 'component').map((i) => [cell(`\`${i.name}\``), badge(i.effort), cell(i.note)])));

  out.push('\n## Routes\n');
  out.push(table(['Path', 'Effort', 'Plan'], items.filter((i) => i.kind === 'route').map((i) => [cell(`\`${i.name}\``), badge(i.effort), cell(i.note)])));

  out.push('\n## Forms\n');
  out.push(table(['Where', 'Effort', 'Plan'], items.filter((i) => i.kind === 'form').map((i) => [cell(`\`${i.name}\``), badge(i.effort), cell(i.note)])));

  out.push("\n## Can't see clearly\n");
  const blind: string[] = [];
  if (!facts.entry) blind.push('- **No entry file found** — point `weave migrate` at the unit folder, or at a specific file.');
  for (const chain of facts.cycles) {
    blind.push(`- **Circular import** — used circularly, reported not resolved: \`${chain.map((f) => f.split(/[\\/]/).pop()).join(' → ')}\``);
  }
  for (const u of facts.unresolved) blind.push(`- **Unresolved import** \`${u}\` — could not be found on disk. Human, look.`);
  for (const cl of facts.calls.filter((c) => c.dynamic)) blind.push(`- **Dynamic call** in \`${cl.from}\` → \`${cl.to}\` — the receiver's type is unknown, so the target is a guess-free \`?\`.`);
  out.push(blind.length ? blind.join('\n') + '\n' : 'Nothing was hidden from the analysis — every import resolved, no cycles, no dynamic calls.\n');

  return out.join('\n');
}

/**
 * Write the rendered plan to `<targetApp>/migration-plan.md` and return the path. `targetApp` is the WEAVE app
 * being migrated into (the directory `weave migrate` ran from) — never the source Angular app, which is only ever
 * read. It sits at the root (not inside `.weave-migrate/`) on purpose: the facts map is machine detail, the plan
 * is for a human to open.
 */
export function writePlan(targetApp: string, markdown: string): string {
  const out: string = join(targetApp, 'migration-plan.md');
  writeFileSync(out, markdown, 'utf8');
  return out;
}
