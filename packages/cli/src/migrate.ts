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
import { join, resolve } from 'node:path';
import {
  analyzeComponents,
  classifyPackages,
  findEntryPoint,
  findWorkspaceRoot,
  walkDependencies,
  type ComponentFact,
  type DependencyWalk,
  type PackagePlan,
} from './migrate-analyze.js';
import { c, inputManager, type InputManager } from './migrate-ui.js';

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
        console.log(c.yellow('No Angular app or project found here or inside.') + ' Type another path:');
      }
      if (!app && io.done()) {
        console.log(c.yellow('\nNothing resolved. Nothing to migrate.'));
        return;
      }
    }

    console.log(`\n${c.green('✓')} ${c.dim('Using:')} ${c.bold(app)}`);

    // 3) analyze — find the entry, walk the dependency tree DOWN to the leaves (M2)
    const entry: string | null = findEntryPoint(app);
    if (!entry) {
      console.log(c.red("\nCouldn't find an entry file (main.ts / index.ts)") + " — point at the unit's folder, or a specific file.");
      return;
    }
    console.log(c.dim(`${c.green('✓')} Entry: ${entry}`));
    console.log(c.dim('Analyzing (following imports down to the leaves)…\n'));
    const walk: DependencyWalk = walkDependencies(entry);
    const list = (xs: string[], n: number): string => (xs.length ? `${xs.slice(0, n).join(', ')}${xs.length > n ? ', …' : ''}` : '(none)');
    const num = (n: number): string => c.bold(String(n)); // counts stand out

    const components: ComponentFact[] = analyzeComponents(walk.files);
    const inputs: number = components.reduce((n, cf) => n + cf.inputs.length, 0);
    const outputs: number = components.reduce((n, cf) => n + cf.outputs.length, 0);

    console.log(c.bold('Found:'));
    console.log(`  ${c.cyan('•')} ${num(walk.files.length)} source files`);
    if (components.length) {
      const io2: string = inputs || outputs ? c.dim(` (${inputs} input(s), ${outputs} output(s))`) : '';
      console.log(`  ${c.green('•')} ${num(components.length)} component(s)${io2}: ${c.green(list(components.map((cf) => cf.selector ?? cf.className), 6))}`);
    }
    console.log(`  ${c.magenta('•')} ${num(walk.angular.length)} @angular APIs used ${c.dim('(these become Weave)')}: ${c.magenta(list(walk.angular, 6))}`);
    if (walk.internal.length) {
      console.log(`  ${c.blue('•')} ${num(walk.internal.length)} of your own workspace lib(s) ${c.dim('(migrate each separately)')}: ${c.blue(list(walk.internal, 6))}`);
    }
    const plans: PackagePlan[] = classifyPackages(walk.thirdParty, findWorkspaceRoot(app));
    console.log(`  ${c.yellow('•')} ${num(plans.length)} third-party package(s): ${list(plans.map((p) => p.name), 8)}`);
    if (walk.cycles.length) console.log(`  ${c.yellow('⚠')} ${c.yellow(`${walk.cycles.length} circular-dependency chain(s) — will be flagged for you`)}`);
    if (walk.unresolved.length) console.log(`  ${c.red('⚠')} ${c.red(`${walk.unresolved.length} import(s) couldn't be resolved — human, look`)}`);

    // 4) decide what to try migrating (M2.8). auto/try → a checkbox you confirm; keep → shown, never a checkbox.
    const attempt: string[] = await choosePackages(io, plans);

    console.log(c.yellow('\nNote: this is assisted, not a 100% automatic migration. Everything you pick is a best'));
    console.log(c.yellow('effort — review each change, and expect some by-hand work.'));
    if (attempt.length) console.log(`\n${c.green('Will attempt to migrate:')} ${attempt.join(', ')}`);
    console.log(c.dim('\n(the written plan + conversion come next — see RFC 0011)'));
  } finally {
    io.close();
  }
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
