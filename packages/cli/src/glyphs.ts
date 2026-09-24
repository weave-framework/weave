/**
 * Output a captured build log can actually read.
 *
 * `weave build` prints `→`, `—`, `✓` and six more. Node writes them as UTF-8 bytes, and when the output is
 * being CAPTURED rather than shown — an MSBuild `Exec` running `npm run build`, a CI step, a log file — the
 * process on the other end decodes those bytes with its own code page. On a US-locale Windows that is CP437,
 * where the three bytes of `→` (`e2 86 92`) read as `ΓåÆ`. Reported from a real build log, where every arrow
 * and every dash in the whole run came out as mojibake.
 *
 * It is not the reader's machine to fix. A program that cannot know how its output will be decoded should not
 * bet the readability of every line on a guess, so when the output is piped on Windows the decoration drops to
 * ASCII. In a terminal nothing changes.
 *
 * The same judgement is already made one file over: `migrate-ui.ts` turns colour off for non-TTY output so
 * that "piped/redirected output stays clean". This is that rule, applied to the characters as well as to the
 * escape codes.
 */

/**
 * What each decorative character becomes when the output cannot be trusted to survive.
 *
 * Only characters WE print for decoration are listed. A file path holding a non-ASCII character is left
 * exactly as it is: it would still be mangled by the same consumer, but mangling a name is a smaller harm
 * than silently changing what the path says.
 */
export const ASCII_FALLBACK: Readonly<Record<string, string>> = {
  '→': '->', // →  build/dev "output goes here"
  '—': '--', // —  the em dash used across the prose
  '•': '*', //  •  list bullets
  '…': '...', // … "working"
  '✓': 'v', //  ✓  done
  '✖': 'x', //  ✖  failed
  '⚠': '!', //  ⚠  warning
  '·': '.', //  ·  separator
  '▲': '^', //  ▲  the "bigger than" marker in the size table
};

/**
 * Whether this run may print the decoration as-is.
 *
 * `WEAVE_UNICODE` and `WEAVE_ASCII` come first and mean exactly what they say, so a build step that knows
 * better than this heuristic can say so. Otherwise: a TTY is fine everywhere (the terminal owns the decoding),
 * and a pipe is fine everywhere EXCEPT Windows, where the capturing process picks an OEM code page rather than
 * UTF-8. A Linux or macOS pipe is UTF-8 by convention and CI logs there show these characters correctly.
 */
export function unicodeSafe(
  platform: string = process.platform,
  isTTY: boolean = Boolean(process.stdout.isTTY),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.WEAVE_ASCII) return false;
  if (env.WEAVE_UNICODE) return true;
  return isTTY || platform !== 'win32';
}

/** Replace every decorative character in one string. Anything not in the table is untouched. */
export function toAscii(text: string): string {
  let out: string = text;
  for (const [from, to] of Object.entries(ASCII_FALLBACK)) out = out.split(from).join(to);
  return out;
}

/**
 * Install the fallback for the whole process, once, at the boundary.
 *
 * Wrapping the two streams rather than editing the eighty-two lines that print these characters: those lines
 * are spread over ten files, a missed one is invisible until somebody's build log shows it, and the next
 * `console.log` written by anyone would reintroduce it. One boundary cannot be forgotten.
 *
 * Only string chunks are rewritten. A `Buffer` reaching stdout is somebody streaming bytes deliberately —
 * a file being copied through, say — and rewriting those would corrupt content rather than decorate it.
 */
export function installAsciiFallback(): void {
  if (unicodeSafe()) return;
  for (const stream of [process.stdout, process.stderr]) {
    const write: typeof stream.write = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]): boolean =>
      (write as (c: unknown, ...r: unknown[]) => boolean)(typeof chunk === 'string' ? toAscii(chunk) : chunk, ...rest)) as typeof stream.write;
  }
}
