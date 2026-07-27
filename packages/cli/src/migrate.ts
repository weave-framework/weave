/**
 * `weave migrate` — the ANGULAR source module (RFC 0011): the command's front door, source-app path resolution,
 * the downward dependency analysis, and the package-decision step. The two layers it stands on are shared by
 * EVERY source-framework module:
 *   • ./migrate-ui      — colours (`c`) + interactive input (`inputManager`). Never print raw `\x1b[..m` here;
 *                         use `c.*` so `NO_COLOR` and piped output are respected for free.
 *   • ./migrate-analyze — the pure fact-gathering (entry point → import walk → package classification).
 * A future `migrate-react.ts` / `migrate-vue.ts` mirrors THIS file: its own detection + a `runMigrate` branch,
 * the same UI + analyzer underneath. That is the whole extension story — one file per source framework.
 *
 * The path resolution is the interesting part: a user may point at a plain Angular app OR at a monorepo root
 * (Nx) whose real app sits deeper in `apps/*`. So detection looks AT the path and, if needed, INSIDE it, and
 * suggests what it found. Zero third-party deps — Node built-ins only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { assembleFacts, mergeFacts, outOfReach, writeFacts, type Coverage, type MigrationFacts, type PackagePlan, type Reach } from './migrate-analyze.js';
import {
  applyWrites,
  carriedInstalls,
  carriedPackages,
  checkSpecs,
  safeSubdir,
  danglingAcrossSections,
  detectPackageManager,
  installCommand,
  installedWeavePackages,
  runInstall,
  planWrites,
  requiredWeavePackages,
  sections,
  symbolTable,
  type PackageManager,
  type WriteItem,
} from './migrate-convert.js';
import { planItems, renderPlan, writePlan, type PlanItem } from './migrate-plan.js';
import { collisions, hasInstalledDeps, verifyOutput, type OutputProblem } from './migrate-verify.js';
import { c, inputManager, type InputManager } from './migrate-ui.js';

/**
 * The install command(s) for a set of packages — one for `dependencies`, one for `devDependencies`.
 *
 * They are separate commands because they land in separate places: what the bundle calls at runtime has to be a
 * real dependency, and what only the type-checker reads must not be shipped to whoever installs this app.
 */
export function installLines(pm: PackageManager, wanted: Array<{ spec: string; dev: boolean }>): string[] {
  const runtime: string[] = wanted.filter((i) => !i.dev).map((i) => i.spec);
  const dev: string[] = wanted.filter((i) => i.dev).map((i) => i.spec);
  const lines: string[] = [];
  if (runtime.length) lines.push(installCommand(pm, runtime));
  if (dev.length) lines.push(installCommand(pm, dev, true));
  return lines;
}

/** Below this many files a section prompt is noise: you can read the list. Above it, the list IS the problem. */
const SECTION_PROMPT_AT: number = 20;

/* ──────────── detection: is there an Angular app here, and where? (Angular-specific — a React module replaces this) ──────────── */

/** Does `dir` DIRECTLY contain an Angular app? `angular.json`, or a `package.json` that depends on `@angular/core`. */
export function detectAngularAt(dir: string): boolean {
  if (existsSync(join(dir, 'angular.json'))) return true;
  const pkg: string = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const j: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = JSON.parse(
        readFileSync(pkg, 'utf8'),
      );
      const deps: Record<string, string> = { ...j.dependencies, ...j.devDependencies };
      if (deps['@angular/core']) return true;
    } catch {
      /* a malformed package.json is not an Angular signal */
    }
  }
  return false;
}

/**
 * An Nx `project.json` that is an Angular unit — an application OR a library. Both are migratable: a service or
 * a component lives inside a library just as much as inside an app, so we do NOT filter libraries out. A big
 * workspace therefore surfaces MANY units, and that is the point — too many to list becomes "type the exact
 * path" (a path can point at any unit, down to a single service folder). Matched by any `@angular` reference.
 */
export function isNxAngularProject(dir: string): boolean {
  const proj: string = join(dir, 'project.json');
  if (!existsSync(proj)) return false;
  try {
    const raw: string = JSON.stringify(JSON.parse(readFileSync(proj, 'utf8')));
    return raw.includes('@angular-devkit') || raw.includes('@nx/angular') || raw.includes('@angular/');
  } catch {
    return false;
  }
}

/** A monorepo ROOT we should look INSIDE rather than treat as the app itself (Nx, or a workspaces root). */
export function looksLikeMonorepo(dir: string): boolean {
  if (existsSync(join(dir, 'nx.json'))) return true;
  if (existsSync(join(dir, 'apps'))) return true;
  const pkg: string = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      if ((JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown }).workspaces) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** One project listed in an `angular.json` — an Angular CLI workspace declares its apps + libs here. */
export interface AngularProject {
  name: string;
  /** Absolute path to the project's root folder. */
  root: string;
  /** 'application' or 'library' (defaults to 'application' when unstated). */
  type: string;
}

/** Read the projects an `angular.json` declares. Empty if there is no `angular.json` (e.g. an Nx workspace). */
export function readAngularProjects(dir: string): AngularProject[] {
  const f: string = join(dir, 'angular.json');
  if (!existsSync(f)) return [];
  try {
    const j: { projects?: Record<string, { root?: string; sourceRoot?: string; projectType?: string }> } = JSON.parse(
      readFileSync(f, 'utf8'),
    );
    return Object.entries(j.projects ?? {}).map(([name, p]) => ({
      name,
      root: resolve(dir, p.root ?? p.sourceRoot ?? '.'),
      type: p.projectType ?? 'application',
    }));
  } catch {
    return [];
  }
}

/**
 * Search `root`'s SUBFOLDERS for Angular apps (never the root itself — a monorepo root carries `@angular/core`
 * but is not an app). An app is a subfolder with its own `angular.json`, or an Nx `project.json` with an Angular
 * build target. A found app is a leaf — the walk does not descend into it, `node_modules`, or dot-dirs.
 */
export function findAngularApps(root: string, maxDepth: number = 5): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (depth >= 1 && (existsSync(join(dir, 'angular.json')) || isNxAngularProject(dir))) {
      found.push(dir);
      return; // a found unit is a leaf
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p: string = join(dir, e);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        /* unreadable entry — skip */
      }
    }
  };
  walk(root, 0);
  return found;
}

/** The outcome of resolving a user-typed path to a real Angular app. */
export interface Resolution {
  /** Resolved unambiguously to a single app. */
  app?: string;
  /** Found several (a monorepo) — the user picks one. */
  candidates?: string[];
  /** Nothing here or inside. */
  none?: boolean;
}

/** A lone hit auto-resolves; several become candidates the user picks; none means nothing was found. */
function pickFrom(apps: string[]): Resolution {
  if (apps.length === 1) return { app: apps[0] };
  return apps.length ? { candidates: apps } : { none: true };
}

/**
 * Resolve a user-typed path to a migration target (an app OR a library — both migratable; a service/component
 * lives inside one). In order:
 * 1. An Angular CLI workspace whose `angular.json` lists SEVERAL projects → offer them all.
 * 2. A monorepo (Nx / `apps/`) → look INSIDE for its units (its root has `@angular/core` but is not itself one).
 * 3. A single unit pointed at directly (one `angular.json` project, or `@angular/core`) → resolve to itself.
 * 4. Otherwise search inside as a fallback.
 * When the result is many, the caller shows "too many — type the exact path" rather than a giant menu.
 */
export function resolveAngularApp(input: string): Resolution {
  const dir: string = resolve(input);
  if (!existsSync(dir)) return { none: true };

  const units: string[] = readAngularProjects(dir).map((p) => p.root); // apps AND libraries — both migratable
  if (units.length > 1) return pickFrom(units); // a multi-project Angular CLI workspace

  if (looksLikeMonorepo(dir)) return pickFrom(findAngularApps(dir)); // Nx / apps-workspace → look inside

  // A directly-typed path to a single unit: a plain Angular app (angular.json / @angular/core), or an Nx project
  // the user explicitly navigated to — trust the explicit choice (its `project.json` marks it; M2 confirms it's
  // Angular). This is what lets a user point straight at one service/library inside a big workspace.
  if (units.length === 1 || detectAngularAt(dir) || existsSync(join(dir, 'project.json'))) return { app: dir };

  return pickFrom(findAngularApps(dir)); // fallback: units may live deeper
}

/* ──────────── the TARGET: the Weave app the migration writes INTO ──────────── */

/**
 * The migration's destination. You run `weave migrate` **from inside the Weave app you are migrating into** —
 * usually a fresh empty one created for this, sometimes an app you already have. So the target is simply the
 * current directory, and everything written (the plan, the facts, and later the converted code) lands there.
 * The SOURCE Angular app is only ever READ — it is never written to, so your other repo stays clean.
 */
export interface Target {
  /** Absolute path of the Weave app being migrated into (the directory you ran the command from). */
  dir: string;
  /** True when this really looks like a Weave app (`weave.config.*`, or a `@weave-framework/*` dependency). */
  isWeave: boolean;
}

/** Does `dir` look like a Weave app? A `weave.config.*`, or a `package.json` depending on `@weave-framework/*`. */
export function looksLikeWeaveApp(dir: string): boolean {
  for (const f of ['weave.config.ts', 'weave.config.js', 'weave.config.mjs']) {
    if (existsSync(join(dir, f))) return true;
  }
  const pkg: string = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const j: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = JSON.parse(readFileSync(pkg, 'utf8'));
      const deps: Record<string, string> = { ...j.dependencies, ...j.devDependencies };
      if (Object.keys(deps).some((d) => d.startsWith('@weave-framework/'))) return true;
    } catch {
      /* a malformed package.json is not a Weave signal */
    }
  }
  return false;
}

/** Resolve the migration target — the directory the command was run from. */
export function resolveTarget(cwd: string = process.cwd()): Target {
  const dir: string = resolve(cwd);
  return { dir, isWeave: looksLikeWeaveApp(dir) };
}

/* ──────────── the interactive command (thin, COLOURED shell over the pure functions above) ──────────── */

const SOURCES: string[] = ['Angular', 'React', 'Vue'];

/** Above this many candidates a scrollable menu is worse than typing the exact path — so we ask for one instead. */
const MENU_MAX: number = 10;

/**
 * `weave migrate` entry — pick a framework, resolve the source path, analyse it, and choose what to try. Every
 * line is coloured through `c` (the palette in ./migrate-ui), which no-ops when output isn't a terminal — so the
 * same code prints a lively terminal session and a clean CI log. Analysis is M2; the plan + conversion are M3/M4.
 */
export async function runMigrate(): Promise<void> {
  const io: InputManager = inputManager();
  try {
    console.log(`\n${c.bold(c.cyan('weave migrate'))}${c.dim(' — assisted migration into Weave')}`);

    // 0) the TARGET — this Weave app. Everything is written HERE; the source app is only ever read.
    const target: Target = resolveTarget();
    console.log(`${c.dim('Migrating into:')} ${c.bold(target.dir)}`);
    if (!target.isWeave) {
      console.log(c.yellow("This doesn't look like a Weave app (no weave.config.* and no @weave-framework/* dependency)."));
      console.log(c.dim('Run `weave migrate` from inside the Weave app you want the code to land in. Continuing anyway.'));
    }

    // 1) framework — arrow-key menu (TTY) or numbered (piped). Only Angular is wired up today.
    const fw: number = await io.selectMenu('Migrate from which framework?', SOURCES);
    if (fw < 0 && io.done()) return; // no input at all — nothing to do
    const source: string | undefined = SOURCES[fw];
    if (source !== 'Angular') {
      console.log(source ? c.yellow(`\n${source} is coming soon. Only Angular is supported today.`) : c.red('\nUnknown choice.'));
      return;
    }

    // 2) path, with deep detection (an app, a library — a service/component migrates from inside one)
    let app: string | undefined;
    while (!app) {
      const input: string = await io.askLine(
        `\n${c.bold('Path to your Angular app or the piece to migrate')}${c.dim(' (full path):')}\n${c.cyan('> ')}`,
      );
      if (!input) {
        if (io.done()) {
          console.log(c.yellow('\nNo path given. Nothing to migrate.'));
          return;
        }
        continue;
      }
      const r: Resolution = resolveAngularApp(input.replace(/^["']|["']$/g, ''));
      if (r.app) {
        app = r.app;
      } else if (r.candidates && r.candidates.length > MENU_MAX) {
        // Too many to pick from a list — show a few so the user knows where they live, then ask for the exact one.
        console.log(c.yellow(`\nFound ${r.candidates.length} Angular projects in there — too many to list.`) + c.dim(' A few of them:'));
        r.candidates.slice(0, 5).forEach((cand) => console.log(c.dim(`  ${cand}`)));
        console.log(c.dim('  …'));
        console.log('Type the exact path to what you want to migrate (an app, a library, or a service inside one):');
        continue; // the loop re-prompts; an exact path resolves straight to that one unit
      } else if (r.candidates && r.candidates.length) {
        console.log(c.dim('\nNo single unit right there. I looked inside and found these — pick one (or Ctrl-C to retype):'));
        const pick: number = await io.selectMenu('Which one?', r.candidates);
        if (pick >= 0 && r.candidates[pick]) app = r.candidates[pick];
      } else {
        // Name the path that was tried. Without it, a stray character leaking in from the framework menu looked
        // exactly like a mistyped path, and the message gave no way to tell the two apart.
        console.log(c.yellow(`No Angular app or project found at "${input}".`) + ' Type another path:');
      }
      if (!app && io.done()) {
        console.log(c.yellow('\nNothing resolved. Nothing to migrate.'));
        return;
      }
    }

    console.log(`\n${c.green('✓')} ${c.dim('Using:')} ${c.bold(app)}`);

    // 3) analyze — assemble the WHOLE facts map for this unit in one pass (M2). The summary below and the written
    //    facts.json are two views of this single object.
    console.log(c.dim('Analyzing (following imports down to the leaves)…\n'));
    const facts: MigrationFacts = assembleFacts(app);
    if (!facts.entry) {
      console.log(c.red("\nCouldn't find an entry file (main.ts / index.ts)") + " — point at the unit's folder, or a specific file.");
      return;
    }
    console.log(c.dim(`${c.green('✓')} Entry: ${facts.entry}`));

    const list = (xs: string[], n: number): string => (xs.length ? `${xs.slice(0, n).join(', ')}${xs.length > n ? ', …' : ''}` : '(none)');
    const num = (n: number): string => c.bold(String(n)); // counts stand out
    const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

    console.log(c.bold('Found:'));
    console.log(`  ${c.cyan('•')} ${num(facts.files.length)} source files`);
    if (facts.components.length) {
      const io2: number = sum(facts.components.map((cf) => cf.inputs.length + cf.outputs.length));
      const meta: string = io2 ? c.dim(` (${sum(facts.components.map((cf) => cf.inputs.length))} input(s), ${sum(facts.components.map((cf) => cf.outputs.length))} output(s))`) : '';
      console.log(`  ${c.green('•')} ${num(facts.components.length)} component(s)${meta}: ${c.green(list(facts.components.map((cf) => cf.selector ?? cf.className), 6))}`);
    }
    if (facts.services.length) {
      const provided: number = facts.services.filter((s) => s.providedIn).length;
      const meta: string = c.dim(` (${provided} provided, ${facts.di.length} DI edge(s))`);
      console.log(`  ${c.green('•')} ${num(facts.services.length)} service(s)${meta}: ${c.green(list(facts.services.map((s) => s.className), 6))}`);
    }
    if (facts.routes.length) {
      const guarded: number = facts.routes.filter((r) => r.guards.length).length;
      const lazy: number = facts.routes.filter((r) => r.lazy).length;
      console.log(`  ${c.green('•')} ${num(facts.routes.length)} route(s)${c.dim(` (${guarded} guarded, ${lazy} lazy)`)}`);
    }
    if (facts.forms.length) {
      console.log(`  ${c.green('•')} ${num(facts.forms.length)} reactive form(s)${c.dim(` (${sum(facts.forms.map((f) => f.controls.length))} control(s))`)}`);
    }
    console.log(`  ${c.magenta('•')} ${num(facts.angular.length)} @angular APIs used ${c.dim('(these become Weave)')}: ${c.magenta(list(facts.angular, 6))}`);
    if (facts.internal.length) {
      console.log(`  ${c.blue('•')} ${num(facts.internal.length)} of your own workspace lib(s) ${c.dim('(migrate each separately)')}: ${c.blue(list(facts.internal, 6))}`);
    }
    console.log(`  ${c.yellow('•')} ${num(facts.packages.length)} third-party package(s): ${list(facts.packages.map((p) => p.name), 8)}`);

    const dynamicCalls: number = facts.calls.filter((e) => e.dynamic).length;
    if (facts.calls.length || facts.branches.length) {
      console.log(c.dim(`  · ${facts.calls.length} call edge(s), ${facts.branches.length} branching method(s)`));
    }
    if (dynamicCalls) console.log(`  ${c.yellow('⚠')} ${c.yellow(`${dynamicCalls} call(s) through an unknown type — human, look`)}`);
    if (facts.cycles.length) console.log(`  ${c.yellow('⚠')} ${c.yellow(`${facts.cycles.length} circular-dependency chain(s) — will be flagged for you`)}`);
    if (facts.unresolved.length) console.log(`  ${c.red('⚠')} ${c.red(`${facts.unresolved.length} import(s) couldn't be resolved — human, look`)}`);

    // 3b) COVERAGE — what this tool does NOT convert, stated before anything is written. Printed unconditionally,
    //     because every gap found so far was found by a human asking, not by the tool admitting it.
    const cov: Coverage = facts.coverage;
    const pct: number = cov.total ? Math.round((cov.handled / cov.total) * 100) : 0;
    console.log(`\n${c.bold('Converted to Weave:')} ${c.bold(`${cov.handled}/${cov.total}`)} ${c.dim('declarations')} (${pct}%)`);
    if (cov.carried) {
      console.log(`${c.dim('Carried over as-is:')} ${c.bold(String(cov.carried))} ${c.dim('— moved into your app, still Angular, yours to port')}`);
    }
    if (cov.gaps.length) {
      console.log(c.yellow('Not converted — carried, but you port these by hand:'));
      for (const g of cov.gaps) {
        console.log(`  ${c.yellow('•')} ${c.bold(String(g.count))} ${g.kind}${g.count > 1 ? 's' : ''}: ${c.dim(list(g.names, 5))}`);
        console.log(`    ${c.dim(g.note)}`);
      }
    }
    if (cov.emptyFiles.length) {
      console.log(`  ${c.yellow('⚠')} ${c.yellow(`${cov.emptyFiles.length} file(s) produce NOTHING`)}${c.dim(': ')}${c.dim(list(cov.emptyFiles.map((f) => f.split(/[\\/]/).pop() ?? f), 5))}`);
    }

    // 3c) ACCESS — a method calls a method calls a method, and some of those live where this walk never went.
    //      Each one is asked for by name, with what is at stake shown; granting it goes deeper, refusing is
    //      recorded so the plan can say "you chose not to show me this" rather than pretending it wasn't there.
    const reached: MigrationFacts = await accessStep(io, facts);

    // 4) decide what to try migrating (M2.8). auto/try → a checkbox you confirm; keep → shown, never a checkbox.
    const attempt: string[] = await choosePackages(io, reached.packages);

    console.log(c.yellow('\nNote: this is assisted, not a 100% automatic migration. Everything you pick is a best'));
    console.log(c.yellow('effort — review each change, and expect some by-hand work.'));
    if (attempt.length) console.log(`\n${c.green('Will attempt to migrate:')} ${attempt.join(', ')}`);

    // 5) write the facts map — the raw measurements, which the plan and the conversion (M4) both read.
    //    Written into THIS Weave app (the target), never into the Angular app: your source repo stays clean.
    const factsPath: string = writeFacts(target.dir, reached);
    console.log(`\n${c.green('✓')} ${c.dim('Wrote the full analysis to')} ${c.bold(factsPath)}`);

    // 6) write the plan (M3) — read this BEFORE anything is converted, so there are no surprises.
    const planPath: string = writePlan(target.dir, renderPlan(reached));
    const items: PlanItem[] = planItems(reached);
    const needs: number = items.filter((i) => i.effort === 'needs-you').length;
    console.log(`${c.green('✓')} ${c.dim('Wrote your migration plan to')} ${c.bold(planPath)}`);
    console.log(
      `  ${c.dim(`${items.length - needs} piece(s) convert mechanically;`)} ${needs ? c.yellow(`${needs} need(s) you`) : c.green('nothing needs you')}${c.dim(' — the plan says which, and why.')}`,
    );
    // 7) convert (M4) — always opt-in, and never overwriting anything that is already there.
    await convertStep(io, reached, target.dir, planPath);
  } finally {
    io.close();
  }
}

/**
 * The project a path belongs to. A user may point at a file, at `src/`, or at the project folder; all three mean
 * the same unit. Climbs until it finds a project marker (`project.json` / `package.json` / `angular.json`), never
 * past the filesystem root, and never treats `src` or `lib` as a unit of its own — that named a "library" `src`,
 * whose output then landed in `src/src/`.
 */
export function unitRootFor(input: string): string {
  let dir: string = existsSync(input) && statSync(input).isDirectory() ? resolve(input) : resolve(input, '..');
  for (let up: number = 0; up < 6; up++) {
    const base: string = dir.split(/[\\/]/).filter(Boolean).pop() ?? '';
    const marked: boolean = ['project.json', 'package.json', 'angular.json', 'ng-package.json'].some((f) => existsSync(join(dir, f)));
    if (marked && base !== 'src' && base !== 'lib') return dir;
    if (base !== 'src' && base !== 'lib' && existsSync(join(dir, 'src'))) return dir;
    const parent: string = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/** One out-of-reach item, as a line the user can act on. */
function reachLabel(g: Reach): string {
  if (g.kind === 'lib') {
    const uses: string = g.uses.length ? c.dim(` — used for ${g.uses.slice(0, 6).join(', ')}${g.uses.length > 6 ? ', …' : ''}`) : '';
    return `${c.blue(g.name)} ${c.dim('(your workspace library)')}${uses}`;
  }
  if (g.kind === 'class') {
    return `${c.magenta(g.name)} ${c.dim(`(injected by ${g.neededBy.length} file(s) — I don't have its class)`)}`;
  }
  return `${c.red(g.name)} ${c.dim("(an import that didn't resolve)")}`;
}

/**
 * ACCESS — the step that makes the analysis go all the way down. A method calls a method calls a method, and some
 * of those live in a workspace library this walk deliberately did not expand, or in a class it never saw at all.
 *
 * Both defaults are wrong on their own: following every workspace library turned ONE imported type into 214
 * files, and following none means a service the app leans on migrates as a name and nothing else. So each one is
 * asked for by name, with what is at stake shown. Granting it re-runs the whole analysis over that unit and folds
 * the result in — and then asks again, because opening one thing reveals the next. Refusing is RECORDED: "you
 * chose not to show me this" and "this wasn't there" are different answers, and the plan says which happened.
 */
async function accessStep(io: InputManager, facts: MigrationFacts): Promise<MigrationFacts> {
  let out: MigrationFacts = facts;
  const asked: Set<string> = new Set<string>();
  const declined: string[] = [];
  let intro: boolean = false;

  // Loop, not a single pass: a granted unit brings its OWN dependencies, and those are the `ccc` behind the `bbb`.
  for (let round: number = 0; round < 10; round++) {
    const gaps: Reach[] = outOfReach(out).filter((g) => !asked.has(`${g.kind}:${g.name}`));
    if (!gaps.length) break;

    if (!intro) {
      intro = true;
      console.log(`\n${c.bold('These are USED here, but I cannot look inside them:')}`);
      console.log(c.dim('Open one up and I follow it down and migrate what I can. Leave it closed and its calls'));
      console.log(c.dim('arrive as TODOs with the original code beside them — your choice, either way recorded.'));
    }

    for (const g of gaps) {
      asked.add(`${g.kind}:${g.name}`);
      console.log(`\n  ${c.yellow('•')} ${reachLabel(g)}`);
      for (const f of g.neededBy.slice(0, 3)) console.log(`    ${c.dim(f)}`);
      if (g.neededBy.length > 3) console.log(`    ${c.dim(`… and ${g.neededBy.length - 3} more`)}`);

      if (io.done()) {
        declined.push(g.name);
        continue;
      }
      let path: string | undefined;
      if (g.path) {
        // The workspace already says where this lives — so the question is permission, not a path.
        console.log(`    ${c.dim('I can reach it at:')} ${c.bold(g.path)}`);
        const yes: string = (await io.askLine(`    ${c.bold('Migrate it too?')} ${c.dim('[y/N]')} ${c.cyan('> ')}`)).trim().toLowerCase();
        if (yes === 'y' || yes === 'yes') path = g.path;
      } else {
        const typed: string = (await io.askLine(`    ${c.bold('Path to it')}${c.dim(' (Enter to skip):')} ${c.cyan('> ')}`)).trim();
        if (typed) path = typed.replace(/^["']|["']$/g, '');
      }
      if (!path) {
        console.log(`    ${c.dim('Skipped — its calls will arrive as TODOs.')}`);
        declined.push(g.name);
        continue;
      }

      // Analysis works on the UNIT, so a file path climbs to the project it belongs to. Stopping at the parent
      // folder made `libs/x/src/index.ts` a "unit" called `src`, and its output landed in `src/src/`.
      const unit: string = unitRootFor(path);
      // Only what is USED from it. A library's entry is a barrel, so analysing one whole migrated 200 interfaces
      // to satisfy an import of one — the complaint that started this, arriving back through the door I opened.
      const extra: MigrationFacts = assembleFacts(unit, g.uses);
      if (!extra.entry) {
        console.log(`    ${c.yellow("Couldn't find an entry file there")} ${c.dim('— nothing read. Treating it as skipped.')}`);
        declined.push(g.name);
        continue;
      }
      const joined: MigrationFacts = mergeFacts(out, extra);
      // It is no longer an un-followed edge, so it must stop being listed as "migrate this one separately".
      out = { ...joined, internal: joined.internal.filter((i) => i !== g.name) };
      console.log(
        `    ${c.green('✓')} ${c.dim('Read')} ${c.bold(String(extra.files.length))} ${c.dim('file(s):')} ` +
          `${c.green(String(extra.components.length))} component(s), ${c.green(String(extra.services.length))} service(s), ` +
          `${c.green(String(extra.pipes.length + extra.directives.length))} pipe(s)/directive(s)`,
      );
    }
  }

  out = { ...out, declined: [...(out.declined ?? []), ...declined] };
  if (declined.length) {
    console.log(`\n${c.dim('Left closed:')} ${declined.join(', ')}${c.dim(' — recorded in the plan, so it is clear these were a choice.')}`);
  }
  return out;
}

/**
 * The conversion step: show exactly what would be written, ask, and only then write. Two rules make this safe to
 * run against an app you already have — it is opt-in (a plain yes/no, defaulting to NO), and a path that already
 * exists is never overwritten, only reported. Nothing here is a surprise: the file list is printed first.
 */
/**
 * Ask where under `src/` the converted code should land.
 *
 * Enter means the root, which is what the command always did — the layout is mirrored from the source, so a
 * library's folders arrive as they were. Typing a folder puts that whole tree under it instead, which is what
 * you want when the app already has a `src/` of its own to keep readable.
 *
 * A path that would escape `src/` is refused and re-asked rather than resolved: this command writes inside the
 * app it was pointed at, and that has to stay true of a typed answer as much as of a computed one.
 */
async function askSubdir(io: InputManager, targetDir: string): Promise<string> {
  for (;;) {
    const typed: string = await io.askLine(
      `
${c.bold('Where should the converted code go?')} ${c.dim(`[Enter = ${join(targetDir, 'src')}, or a folder under it]`)}
${c.cyan('> ')}`,
    );
    const chosen: string | null = safeSubdir(typed);
    if (chosen !== null) {
      if (chosen) console.log(c.dim(`  → ${join(targetDir, 'src', chosen)}`));
      return chosen;
    }
    console.log(`${c.red('✖')} ${c.yellow('That path would land outside the app.')} ${c.dim('Type a folder relative to src/, like `features/breadcrumbs`.')}`);
  }
}

async function convertStep(io: InputManager, facts: MigrationFacts, targetDir: string, planPath: string): Promise<void> {
  if (!planWrites(facts, targetDir).length) {
    console.log(c.dim('\nNothing to convert yet — no components were found in this unit.'));
    return;
  }
  // WHERE it lands, asked before anything is planned. The output mirrors the source layout, so without this a
  // whole Angular folder tree drops into the root of an app that already has one of its own. Empty keeps the
  // previous behaviour exactly, so "put it where it went before" is the Enter key.
  const subdir: string = await askSubdir(io, targetDir);
  const items: WriteItem[] = planWrites(facts, targetDir, subdir);
  const outRoot: string = join(targetDir, 'src', subdir);
  let fresh: WriteItem[] = items.filter((i) => i.status === 'write');
  const blocked: WriteItem[] = items.filter((i) => i.status === 'skip-exists');

  // SECTIONS. A big unit is not migrated in one sitting, and a list of two hundred files is not a thing anyone
  // reviews. The mapping spans the whole unit either way, so section two knows what section one renamed — but
  // what a chosen section NEEDS from one left behind has to be said, or the code lands not resolving and the
  // reason was a decision made three prompts earlier.
  const groups: Array<{ name: string; paths: string[] }> = sections(fresh.map((i) => i.path), outRoot);
  if (groups.length > 1 && fresh.length > SECTION_PROMPT_AT) {
    console.log(`\n${c.bold(`${fresh.length} files across ${groups.length} sections.`)}${c.dim(' Migrate all of it, or a section at a time:')}`);
    const labels: string[] = groups.map((g) => `${g.name}  ${c.dim(`(${g.paths.length} file(s))`)}`);
    const picked: boolean[] = await io.multiSelect('Which sections?', labels, groups.map(() => true));
    const keep: Set<string> = new Set<string>(groups.filter((_, i) => picked[i]).flatMap((g) => g.paths));
    if (!keep.size) {
      console.log(c.dim('\nNo sections chosen. Nothing written.'));
      return;
    }
    fresh = fresh.filter((i) => keep.has(i.path));
    const dangling: Array<{ file: string; needs: string; from: string }> = danglingAcrossSections(fresh, symbolTable(facts, targetDir, subdir));
    if (dangling.length) {
      console.log(`\n${c.yellow('What you chose depends on what you did not:')}`);
      for (const d of dangling.slice(0, 8)) {
        console.log(`  ${c.yellow('•')} ${relative(targetDir, d.file)} ${c.dim('needs')} ${c.bold(d.needs)} ${c.dim(`from ${relative(targetDir, d.from)}`)}`);
      }
      if (dangling.length > 8) console.log(c.dim(`  … and ${dangling.length - 8} more`));
      console.log(c.dim('  Those imports will not resolve until you run the remaining sections. Nothing is lost — run again.'));
    }
  }

  console.log(`\n${c.bold('Convert now?')} ${c.dim(`This would create ${fresh.length} file(s) under`)} ${c.bold(join(targetDir, 'src'))}${c.dim(':')}`);
  for (const i of fresh.slice(0, 10)) console.log(`  ${c.green('+')} ${relative(targetDir, i.path)}`);
  if (fresh.length > 10) console.log(c.dim(`  … and ${fresh.length - 10} more`));
  for (const i of blocked) console.log(`  ${c.yellow('•')} ${c.yellow(`${relative(targetDir, i.path)} — already exists, will NOT be touched`)}`);

  // Packages the generated code imports that this app does not have. The scaffold ships runtime/router/store/
  // forms/i18n/data but NOT ui — so migrating off Angular Material writes imports nothing can resolve.
  const missing: string[] = requiredWeavePackages(items).filter((p) => !installedWeavePackages(targetDir).includes(p));
  if (missing.length) {
    // The install command follows THIS app's package manager: `pnpm i x` does not add a dependency the way
    // `npm i x` does, and running npm inside a pnpm project rewrites node_modules behind pnpm's back.
    console.log(`\n${c.yellow('This code needs packages your app does not have yet:')}`);
    console.log(`  ${c.bold(installCommand(detectPackageManager(targetDir), missing))}`);
  }

  // The dependencies this migration HANDS your app. The plan says `rxjs` is replaced by Weave's reactivity, and
  // then the converted files import it anyway, because a stream is not something to rewrite by guess. Both
  // halves are defensible; saying only the first one is not.
  const carried: string[] = carriedPackages(items);
  if (carried.length) {
    console.log(`\n${c.bold('Your converted code still imports these — they stay dependencies of your app:')}`);
    for (const name of carried) {
      const plan: PackagePlan | undefined = facts.packages.find((p) => p.name === name);
      // An `@angular/*` package in the OUTPUT means something was carried, not converted — saying "no Weave
      // role, kept as-is" about the framework being migrated away from reads as if that were the plan.
      const note: string = name.startsWith('@angular')
        ? c.yellow('still Angular — this comes from a file that was CARRIED, not converted')
        : plan?.decision === 'auto'
          ? c.yellow('Weave replaces this — what is left is what could not be translated without guessing')
          : c.dim(plan?.note ?? 'no Weave role — kept as-is');
      console.log(`  ${c.yellow('•')} ${c.bold(name)} ${c.dim('—')} ${note}`);
    }
    console.log(c.dim('  Grep the written files for each one: every remaining use is a decision the tool would not make for you.'));
    // Naming them and stopping there left the app importing modules nothing provides, so the first `weave check`
    // after a migration was a wall of "cannot find module" with the real TODOs buried in it. The versions come
    // from the SOURCE app, so the code lands against what it was written for rather than whatever is latest.
    const installs: Array<{ name: string; spec: string; dev: boolean }> = carriedInstalls(items, facts.unit, targetDir);
    if (installs.length) {
      console.log(`\n${c.yellow('Your app does not have these yet:')}`);
      // The SAME two commands the offer below runs. Printing one combined line here and two there said the
      // type-only packages would land in `dependencies`, which is not where they go.
      for (const line of installLines(detectPackageManager(targetDir), installs)) console.log(`  ${c.bold(line)}`);
      console.log(c.dim('  (Offered again after writing. `@angular/*` is never on this list — installing it would undo the migration.)'));
    }
  }

  // Does what we are about to write HOLD TOGETHER? Everything above looked at one declaration at a time; this
  // type-checks the planned files as one program, so a rename that landed in one file and not in its importer
  // is a line on screen instead of something you find later.
  const dupes: Array<{ path: string; count: number }> = collisions(items);
  for (const d of dupes) {
    console.log(`\n${c.red('✖')} ${c.red(`${d.count} files would be written to ${relative(targetDir, d.path)}`)}${c.dim(' — the last one wins and the others vanish.')}`);
  }
  if (hasInstalledDeps(targetDir)) {
    const problems: OutputProblem[] = verifyOutput(items, targetDir);
    const defects: OutputProblem[] = problems.filter((p) => p.kind === 'defect');
    const missingDeps: string[] = [...new Set(problems.filter((p) => p.kind === 'missing-dependency').map((p) => p.module ?? ''))].filter(Boolean);
    if (!problems.length) {
      console.log(`\n${c.green('✓')} ${c.dim('The converted code type-checks as a whole.')}`);
    } else {
      if (missingDeps.length) {
        console.log(`\n${c.yellow('These are imported but not installed here:')} ${missingDeps.join(', ')}`);
        console.log(c.dim('  Nothing is wrong with the conversion — it names what your source named.'));
      }
      if (defects.length) {
        const files: number = new Set(defects.map((p) => p.file)).size;
        console.log(`\n${c.red(`${defects.length} problem(s) in the converted code itself`)}${c.dim(`, across ${files} file(s) — this is what still needs a hand:`)}`);
        for (const p of defects.slice(0, 12)) console.log(`  ${c.red('•')} ${c.bold(`${p.file}:${p.line}`)} ${c.dim(p.message)}`);
        if (defects.length > 12) console.log(c.dim(`  … and ${defects.length - 12} more`));
      }
    }
  } else {
    console.log(c.dim('\n(Skipping the type-check of the output: this app has no node_modules yet, so nothing would resolve.)'));
  }

  console.log(c.dim(`\nThe converted code is a starting point: read ${relative(targetDir, planPath)} and the`));
  console.log(c.dim('TODO(weave migrate) comments — the pieces marked "needs you" are not done automatically.'));

  const answer: string = await io.askLine(`\n${c.bold('Write these files?')} ${c.dim('[y/N]')} ${c.cyan('> ')}`);
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log(c.dim('\nNothing written. The plan and the analysis are still there when you want them.'));
    return;
  }
  const { written, skipped } = applyWrites(items);
  console.log(`\n${c.green('✓')} ${c.dim('Wrote')} ${c.bold(String(written.length))} ${c.dim('file(s).')}`);
  if (skipped.length) console.log(`${c.yellow('•')} ${c.yellow(`${skipped.length} left untouched because a file was already there.`)}`);

  // The packages the written code needs. Asked rather than done: installing writes package.json and the
  // lockfile and goes to the network, and this app's manager is the one that must do it — running `npm i` in a
  // pnpm project rewrites node_modules behind pnpm's back.
  const wanted: Array<{ name: string; spec: string; dev: boolean }> = [
    ...requiredWeavePackages(items)
      .filter((p) => !installedWeavePackages(targetDir).includes(p))
      .map((p) => ({ name: p, spec: p, dev: false })),
    ...carriedInstalls(items, facts.unit, targetDir),
  ];
  const needed: string[] = wanted.map((i) => i.spec);
  if (needed.length) {
    const pm: PackageManager = detectPackageManager(targetDir);
    console.log(`\n${c.bold('The written code needs packages this app does not have:')}`);
    for (const line of installLines(pm, wanted)) console.log(`  ${c.bold(line)}`);
    // A spec that is not a plain package name is never run. These come from `import` specifiers in the code
    // being migrated, so migrating a repository you did not write must not be able to run a command.
    const { refused } = checkSpecs(needed);
    if (refused.length) {
      console.log(`${c.red('✖')} ${c.yellow(`Not offering to run this: ${refused.join(', ')} ${refused.length === 1 ? 'is not' : 'are not'} a package name.`)}`);
      console.log(c.dim('  Check where that came from before installing anything by hand.'));
    }
    const run: string = refused.length ? 'n' : await io.askLine(`${c.bold('Run it now?')} ${c.dim(`[y/N] (${pm}, in ${targetDir})`)} ${c.cyan('> ')}`);
    if (/^y(es)?$/i.test(run.trim())) {
      // Two commands when both kinds are present: what the bundle needs goes to `dependencies`, and what only
      // the type-checker needs goes to `devDependencies`. One list would put one of them in the wrong place.
      const runtime: string[] = wanted.filter((i) => !i.dev).map((i) => i.spec);
      const dev: string[] = wanted.filter((i) => i.dev).map((i) => i.spec);
      const ok: boolean =
        (!runtime.length || runInstall(pm, runtime, targetDir, false)) && (!dev.length || runInstall(pm, dev, targetDir, true));
      console.log(ok ? `${c.green('✓')} ${c.dim('Installed.')}` : `${c.red('✖')} ${c.yellow('The install failed — run the command above yourself and read its output.')}`);
    } else {
      console.log(c.dim('  Not installed. The imports will not resolve until you run that.'));
    }
  }
  console.log(c.dim('Now run `weave check` in this app and work through the TODOs.'));
}

/**
 * Ask the user which third-party packages to attempt. `auto` (confident) + `try` (your call) become checkboxes —
 * `auto` pre-checked; `keep` packages have NO Weave role, so they are listed for information only (ticking one
 * would do nothing). Returns the package names the user chose to attempt. Option labels stay PLAIN text (no
 * embedded colour): the checkbox widget measures label width to truncate, and escape codes would throw that off —
 * the widget supplies its own colour (green tick, cyan cursor).
 */
async function choosePackages(io: InputManager, plans: PackagePlan[]): Promise<string[]> {
  const keep: PackagePlan[] = plans.filter((p) => p.decision === 'keep');
  const choose: PackagePlan[] = plans.filter((p) => p.decision !== 'keep');
  if (keep.length) {
    console.log(c.gray('\nKept as-is (no Weave equivalent — you keep using these):'));
    for (const p of keep) console.log(c.gray(`  • ${p.name} — ${p.note}`));
  }
  if (!choose.length) return [];
  const labels: string[] = choose.map((p) => `${p.name}  ${p.note}`);
  const preChecked: boolean[] = choose.map((p) => p.decision === 'auto'); // confident ones start ticked
  const mask: boolean[] = await io.multiSelect('Which packages should I try to migrate? (space to toggle)', labels, preChecked);
  return choose.filter((_, i) => mask[i]).map((p) => p.name);
}
