/**
 * `weave migrate` — the shared PRESENTATION layer (RFC 0011). Colours + interactive input, reused by every
 * source-framework module. `migrate.ts` (Angular) uses it today; a future `migrate-react.ts` / `migrate-vue.ts`
 * imports the SAME `c` palette and `inputManager()` so every migration looks and feels identical — a new module
 * writes only its own detection/analysis, never its own prompts or colours.
 *
 * Two things live here:
 *   1. `c` — a tiny ANSI colour palette. Every colour AUTO-DISABLES when output is not a real terminal or when
 *      `NO_COLOR` is set, so piped/redirected output stays clean (no `\x1b[..m` gibberish) and CI logs are plain.
 *   2. `inputManager()` — line prompts, an arrow-key menu, and a checkbox list, each working over BOTH a real
 *      terminal and piped stdin.
 *
 * Zero third-party deps — Node built-ins only (this is RULE #1; the whole CLI holds to it).
 */
import { createInterface, emitKeypressEvents, type Interface } from 'node:readline';

/* ──────────── 1. colours ──────────── */

// Colour is ON for a real terminal (or when `FORCE_COLOR` asks — e.g. piping into a pager that renders codes),
// and always OFF when `NO_COLOR` is set (the cross-tool opt-out). Computed once: none of these change mid-run.
// When OFF, every helper below returns its input untouched — so the SAME code path prints clean text when piped
// (which is also why the smoke test, run head-less, sees no escape codes).
const COLOR: boolean = !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));

/** A colour helper: takes text, returns it wrapped in an ANSI colour (or unchanged when colour is off). */
export type Colorize = (s: string) => string;

/** The palette's names — one semantic colour per intent. */
export type Palette = Record<'bold' | 'dim' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray', Colorize>;

/** Wrap text in an ANSI colour pair (open→close SGR codes), but only when colour is enabled. */
const sgr =
  (open: number, close: number): Colorize =>
  (s: string): string =>
    COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : s;

/**
 * The migrate palette. Semantic names, not raw codes, so the whole command reads intent: `c.green` for a good
 * outcome, `c.yellow` for a caveat, `c.cyan` for a heading, `c.dim`/`c.gray` for secondary text. Reuse these in
 * every framework module — do NOT hand-roll `\x1b[..m` at call sites (it wouldn't respect `NO_COLOR`).
 */
export const c: Palette = {
  bold: sgr(1, 22), //     emphasis (headings, the app name)
  dim: sgr(2, 22), //      secondary / hint text
  red: sgr(31, 39), //     an error / a blocking problem
  green: sgr(32, 39), //   success, a confident auto-mapping, a ticked box
  yellow: sgr(33, 39), //  a caveat — the "not 100% automatic" honesty note, warnings
  blue: sgr(34, 39), //    your own workspace libs (internal edges)
  magenta: sgr(35, 39), // the framework surface (@angular/* APIs to translate)
  cyan: sgr(36, 39), //    headings, the selection cursor
  gray: sgr(90, 39), //    kept-as-is / de-emphasised
};

/* ──────────── 2. interactive input ──────────── */

export interface InputManager {
  /** Free-text prompt (a path). Returns the trimmed line, or '' at EOF. */
  askLine: (prompt: string) => Promise<string>;
  /** A menu: arrow-key + Enter in a real terminal, number-typing under piped input or on any fallback. -1 = none. */
  selectMenu: (title: string, options: string[]) => Promise<number>;
  /** A checkbox list: ↑/↓ move, space toggles, `a` toggles all, Enter confirms. Returns the final checked mask.
   *  Under piped input it prints the list and reads a line of numbers to toggle (blank = accept the defaults). */
  multiSelect: (title: string, options: string[], checked: boolean[]) => Promise<boolean[]>;
  /** True once stdin has ended AND its buffered lines are all consumed — the caller must stop asking. */
  done: () => boolean;
  close: () => void;
}

/**
 * Input over BOTH a real terminal and piped stdin. Text uses a buffered line-queue (`readline.question` drops a
 * line under piped input — the line event can fire before the next question registers its callback). A menu
 * navigates with the arrow keys + Enter in a TTY, and degrades to typing a number when piped or if raw mode is
 * unavailable — so a menu is never broken, only prettier in a real terminal.
 */
/**
 * Strip ANSI escape sequences and control characters from a typed line, then trim it.
 *
 * Terminal input is not always the clean text it looks like: raw mode (used by the arrow menus) can leave the
 * `\r` of a confirming Enter, or trailing bytes of an arrow key's `\x1b[A` sequence, in the stream. Those arrive
 * as a "line" that is invisible but not empty — and an invisible non-empty line was being taken for a typed path.
 */
export function sanitize(line: string): string {
  return line
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI sequences (arrow keys, cursor moves)
    .replace(/\x1b[@-Z\\-_]/g, '') // two-character escape sequences
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '') // control characters, tab/newline excluded above
    .trim();
}

/** True when a line carries nothing a human typed, once control characters are stripped. */
function isBlank(line: string | null): boolean {
  return line === null || sanitize(line) === '';
}

export function inputManager(): InputManager {
  const rl: Interface = createInterface({ input: process.stdin, terminal: false });
  const queue: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed: boolean = false;
  // After a TTY arrow-select, the confirming Enter leaks into the resumed readline as one empty line — swallow it
  // once so the next text prompt is not skipped (which showed the path prompt twice).
  let swallowEmpty: boolean = false;
  rl.on('line', (l: string) => {
    const w: ((line: string) => void) | undefined = waiters.shift();
    if (w) w(l);
    else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w('');
  });

  const rawRead = (): Promise<string | null> => {
    const next: string | undefined = queue.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (closed) return Promise.resolve(null); // EOF
    return new Promise<string | null>((res) => waiters.push((l) => res(l)));
  };

  const askLine = async (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    let line: string | null = await rawRead();
    if (swallowEmpty) {
      swallowEmpty = false;
      // The confirming keypress leaks into the resumed readline. It is NOT always a clean empty line: raw mode
      // can hand back the `\r` of the Enter, or leftover bytes of an arrow key's escape sequence, and a line
      // made only of those looked like a typed path — which is why picking a framework used to answer the next
      // question with a bogus one. Anything that is empty ONCE control characters are stripped is discarded.
      if (isBlank(line)) line = await rawRead();
    }
    return line === null ? '' : sanitize(line);
  };

  /** Fallback menu: print numbered options, read one line, parse the number (or the option text). */
  const selectByNumber = async (title: string, options: string[]): Promise<number> => {
    let out: string = `\n${c.cyan(title)}\n`;
    options.forEach((o, i) => (out += `  ${c.dim(`${i + 1})`)} ${o}\n`));
    const a: string = await askLine(`${out}${c.cyan('> ')}`);
    const n: number = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
    return options.findIndex((o) => o.toLowerCase() === a.toLowerCase());
  };

  /** Arrow-key menu (TTY only): highlight a row, ↑/↓ to move, Enter to pick. Any hiccup → number fallback. */
  const selectByArrows = (title: string, options: string[]): Promise<number> =>
    new Promise<number>((res, rej) => {
      const stdin: NodeJS.ReadStream = process.stdin;
      let idx: number = 0;
      let top: number = 0; // first visible option (the window scrolls as idx moves past its edges)
      const VIEW: number = Math.min(10, options.length);
      const HEIGHT: number = 1 + VIEW + 1; // title + window rows + hint line — a constant, so redraw is exact
      emitKeypressEvents(stdin);
      const trunc = (s: string): string => {
        const w: number = (process.stdout.columns ?? 80) - 4;
        return s.length > w ? `…${s.slice(s.length - w + 1)}` : s; // left-truncate: keep the app name (path end)
      };
      const draw = (first: boolean): void => {
        if (idx < top) top = idx;
        else if (idx >= top + VIEW) top = idx - VIEW + 1;
        if (!first) process.stdout.write(`\x1b[${HEIGHT}A`); // cursor up to redraw in place
        process.stdout.write(`\x1b[2K${c.cyan(title)}\n`);
        for (let i: number = 0; i < VIEW; i++) {
          const oi: number = top + i;
          const row: string = trunc(options[oi]);
          // the highlighted row: a cyan cursor + cyan text; the rest plain (two leading spaces to align).
          process.stdout.write(`\x1b[2K${oi === idx ? c.cyan(`> ${row}`) : `  ${row}`}\n`);
        }
        const more: string[] = [];
        if (top > 0) more.push(`↑${top} more`);
        if (top + VIEW < options.length) more.push(`↓${options.length - top - VIEW} more`);
        process.stdout.write(`\x1b[2K${c.dim(`${more.join('  ')}  (${idx + 1}/${options.length})`)}\n`);
      };
      const cleanup = (): void => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(false);
        rl.resume();
      };
      const onKey = (_s: string, key: { name?: string; ctrl?: boolean } | undefined): void => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }
        if (key.name === 'up') idx = (idx - 1 + options.length) % options.length;
        else if (key.name === 'down') idx = (idx + 1) % options.length;
        else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          res(idx);
          return;
        } else return;
        draw(false);
      };
      try {
        rl.pause();
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume(); // keep the stream flowing + ref'd, else the event loop empties and Node exits before a keypress
        stdin.on('keypress', onKey);
        process.stdout.write('\n');
        draw(true);
      } catch (e) {
        cleanup();
        rej(e);
      }
    });

  /** Fallback checkbox list: print with [x]/[ ], read one line of numbers to TOGGLE (blank = keep the defaults). */
  const multiByNumber = async (title: string, options: string[], checked: boolean[]): Promise<boolean[]> => {
    const mask: boolean[] = [...checked];
    let out: string = `\n${c.cyan(title)}\n`;
    options.forEach((o, i) => (out += `  ${c.dim(`${i + 1})`)} ${mask[i] ? c.green('[x]') : '[ ]'} ${o}\n`));
    const a: string = await askLine(`${out}${c.dim('Numbers to toggle (comma-separated), or Enter to accept:')}\n${c.cyan('> ')}`);
    for (const tok of a.split(/[\s,]+/).filter(Boolean)) {
      const n: number = Number(tok);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) mask[n - 1] = !mask[n - 1];
    }
    return mask;
  };

  /** Arrow-key checkbox list (TTY only): ↑/↓ move, space toggles the row, `a` toggles all, Enter confirms. */
  const multiByArrows = (title: string, options: string[], checked: boolean[]): Promise<boolean[]> =>
    new Promise<boolean[]>((res, rej) => {
      const stdin: NodeJS.ReadStream = process.stdin;
      const mask: boolean[] = [...checked];
      let idx: number = 0;
      let top: number = 0;
      const VIEW: number = Math.min(10, options.length);
      const HEIGHT: number = 1 + VIEW + 1;
      emitKeypressEvents(stdin);
      const trunc = (s: string): string => {
        const w: number = (process.stdout.columns ?? 80) - 8; // room for "> [x] "
        return s.length > w ? `${s.slice(0, w - 1)}…` : s;
      };
      const draw = (first: boolean): void => {
        if (idx < top) top = idx;
        else if (idx >= top + VIEW) top = idx - VIEW + 1;
        if (!first) process.stdout.write(`\x1b[${HEIGHT}A`);
        process.stdout.write(`\x1b[2K${c.cyan(title)}\n`);
        for (let i: number = 0; i < VIEW; i++) {
          const oi: number = top + i;
          const box: string = mask[oi] ? c.green('[x]') : '[ ]'; // a ticked box is green — reads at a glance
          const label: string = trunc(options[oi]);
          const row: string = `${box} ${label}`;
          process.stdout.write(`\x1b[2K${oi === idx ? c.cyan('> ') : '  '}${row}\n`);
        }
        process.stdout.write(`\x1b[2K${c.dim(`space toggle · a all · Enter confirm  (${idx + 1}/${options.length})`)}\n`);
      };
      const cleanup = (): void => {
        stdin.removeListener('keypress', onKey);
        if (stdin.isTTY) stdin.setRawMode(false);
        rl.resume();
      };
      const onKey = (s: string, key: { name?: string; ctrl?: boolean } | undefined): void => {
        if (!key) return;
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }
        if (key.name === 'up') idx = (idx - 1 + options.length) % options.length;
        else if (key.name === 'down') idx = (idx + 1) % options.length;
        else if (key.name === 'space' || s === ' ') mask[idx] = !mask[idx];
        else if (key.name === 'a') {
          const anyOff: boolean = mask.some((m) => !m);
          for (let i: number = 0; i < mask.length; i++) mask[i] = anyOff; // all-on if any was off, else all-off
        } else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          res(mask);
          return;
        } else return;
        draw(false);
      };
      try {
        rl.pause();
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        stdin.on('keypress', onKey);
        process.stdout.write('\n');
        draw(true);
      } catch (e) {
        cleanup();
        rej(e);
      }
    });

  return {
    askLine,
    async selectMenu(title: string, options: string[]): Promise<number> {
      if (!process.stdin.isTTY) return selectByNumber(title, options);
      try {
        const picked: number = await selectByArrows(title, options);
        swallowEmpty = true; // the confirming Enter will surface as one empty line — the next askLine drops it
        return picked;
      } catch {
        return selectByNumber(title, options);
      }
    },
    async multiSelect(title: string, options: string[], checked: boolean[]): Promise<boolean[]> {
      if (!process.stdin.isTTY) return multiByNumber(title, options, checked);
      try {
        const mask: boolean[] = await multiByArrows(title, options, checked);
        swallowEmpty = true; // the confirming Enter surfaces as one empty line — the next askLine drops it
        return mask;
      } catch {
        return multiByNumber(title, options, checked);
      }
    },
    done: () => closed && queue.length === 0,
    close: () => rl.close(),
  };
}
