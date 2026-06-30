/**
 * @weave-framework/i18n — message formatter. Zero dependencies (native `Intl` only).
 *
 * A compact, self-contained ICU MessageFormat subset — the in-house answer to
 * transloco's `messageformat` plugin, with no third-party code (rule #1). It
 * understands, in one pass:
 *
 *   - `{{ name }}`            — simple interpolation (transloco-style double brace)
 *   - `{ name }`             — simple interpolation (ICU single brace)
 *   - `{ n, plural, ... }`   — cardinal plural via `Intl.PluralRules`, with `=N`
 *                              exact cases and `#` → the formatted number
 *   - `{ n, selectordinal }` — ordinal plural (1st / 2nd / 3rd …)
 *   - `{ g, select, ... }`   — keyed branch (e.g. gender)
 *   - `{ x, number[, style] }`           — `Intl.NumberFormat` (integer / percent)
 *   - `{ d, date|time[, short|…|full] }` — `Intl.DateTimeFormat`
 *
 * Sub-messages nest to any depth and may themselves contain `{{ }}` / `#`.
 * ICU apostrophe quoting (`'{'`, `''`) escapes literal braces.
 */

/** A value bag passed to {@link formatMessage} — keyed by placeholder name. */
export type FormatParams = Record<string, unknown>;

const WS: RegExp = /\s/;

function stringify(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function formatPlainNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatNumberStyled(value: number, locale: string, style?: string): string {
  const opts: Intl.NumberFormatOptions =
    style === 'percent'
      ? { style: 'percent' }
      : style === 'integer'
        ? { maximumFractionDigits: 0 }
        : {};
  return new Intl.NumberFormat(locale, opts).format(value);
}

type DateLen = 'short' | 'medium' | 'long' | 'full';
const DATE_LENS: ReadonlySet<string> = new Set(['short', 'medium', 'long', 'full']);

function formatDateTime(value: unknown, locale: string, style: string | undefined, kind: 'date' | 'time'): string {
  const date: Date = value instanceof Date ? value : new Date(value as string | number);
  const len: DateLen = (style && DATE_LENS.has(style) ? style : 'medium') as DateLen;
  const opts: Intl.DateTimeFormatOptions = kind === 'date' ? { dateStyle: len } : { timeStyle: len };
  return new Intl.DateTimeFormat(locale, opts).format(date);
}

interface ArgNode {
  name: string;
  type?: string;
  style?: string;
  options?: Array<{ selector: string; message: string }>;
}

function isWs(ch: string): boolean {
  return WS.test(ch);
}

function skipWs(msg: string, i: number): number {
  while (i < msg.length && isWs(msg[i])) i++;
  return i;
}

/** Read a `{ … }` block starting at `i` (a `{`), returning its inner text and the index past the `}`. */
function readBalanced(msg: string, i: number): { text: string; end: number } {
  let depth: number = 0;
  let j: number = i;
  for (; j < msg.length; j++) {
    if (msg[j] === '{') depth++;
    else if (msg[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return { text: msg.slice(i + 1, j), end: j + 1 };
}

/** Parse one `{ name[, type[, …]] }` argument starting at `start` (a `{`). */
function parseArgument(msg: string, start: number): { node: ArgNode; end: number } {
  let i: number = skipWs(msg, start + 1);
  let name: string = '';
  while (i < msg.length && msg[i] !== ',' && msg[i] !== '}' && !isWs(msg[i])) name += msg[i++];
  i = skipWs(msg, i);
  if (msg[i] === '}') return { node: { name }, end: i + 1 };

  i = skipWs(msg, i + 1); // past ','
  let type: string = '';
  while (i < msg.length && msg[i] !== ',' && msg[i] !== '}' && !isWs(msg[i])) type += msg[i++];
  i = skipWs(msg, i);
  if (msg[i] === '}') return { node: { name, type }, end: i + 1 };

  i = skipWs(msg, i + 1); // past ','
  if (type === 'plural' || type === 'select' || type === 'selectordinal') {
    const options: Array<{ selector: string; message: string }> = [];
    while (i < msg.length && msg[i] !== '}') {
      let sel: string = '';
      while (i < msg.length && !isWs(msg[i]) && msg[i] !== '{') sel += msg[i++];
      i = skipWs(msg, i);
      if (msg[i] !== '{') break;
      const sub: { text: string; end: number } = readBalanced(msg, i);
      options.push({ selector: sel, message: sub.text });
      i = skipWs(msg, sub.end);
    }
    return { node: { name, type, options }, end: i + 1 };
  }

  let style: string = '';
  while (i < msg.length && msg[i] !== '}') style += msg[i++];
  return { node: { name, type, style: style.trim() }, end: i + 1 };
}

function pickOption(options: ArgNode['options'], selector: string): string | undefined {
  return options?.find((o) => o.selector === selector)?.message;
}

function renderArgument(node: ArgNode, params: FormatParams | undefined, locale: string): string {
  const raw: unknown = params?.[node.name];
  switch (node.type) {
    case undefined:
      return stringify(raw);
    case 'number':
      return formatNumberStyled(Number(raw), locale, node.style);
    case 'date':
    case 'time':
      return formatDateTime(raw, locale, node.style, node.type);
    case 'select': {
      const msg: string | undefined = pickOption(node.options, String(raw)) ?? pickOption(node.options, 'other');
      return msg === undefined ? '' : formatMessage(msg, params, locale);
    }
    case 'plural':
    case 'selectordinal': {
      const num: number = Number(raw);
      let msg: string | undefined = pickOption(node.options, '=' + num);
      if (msg === undefined) {
        const cat: Intl.LDMLPluralRule = new Intl.PluralRules(locale, {
          type: node.type === 'selectordinal' ? 'ordinal' : 'cardinal',
        }).select(num);
        msg = pickOption(node.options, cat) ?? pickOption(node.options, 'other');
      }
      return msg === undefined ? '' : formatMessage(msg, params, locale, num);
    }
    default:
      return stringify(raw);
  }
}

/**
 * Format `msg` against `params` for `locale`. `pound` is the active plural value,
 * substituted for `#` inside a plural sub-message (undefined at the top level).
 */
export function formatMessage(
  msg: string,
  params: FormatParams | undefined,
  locale: string,
  pound?: number
): string {
  let out: string = '';
  let i: number = 0;
  const n: number = msg.length;
  while (i < n) {
    const ch: string = msg[i];
    if (ch === '#' && pound !== undefined) {
      out += formatPlainNumber(pound, locale);
      i++;
    } else if (ch === "'") {
      if (msg[i + 1] === "'") {
        out += "'";
        i += 2;
      } else {
        const end: number = msg.indexOf("'", i + 1);
        if (end === -1) {
          out += msg.slice(i + 1);
          i = n;
        } else {
          out += msg.slice(i + 1, end);
          i = end + 1;
        }
      }
    } else if (ch === '{') {
      if (msg[i + 1] === '{') {
        const end: number = msg.indexOf('}}', i + 2);
        if (end === -1) {
          out += msg.slice(i);
          break;
        }
        out += stringify(params?.[msg.slice(i + 2, end).trim()]);
        i = end + 2;
      } else {
        const parsed: { node: ArgNode; end: number } = parseArgument(msg, i);
        out += renderArgument(parsed.node, params, locale);
        i = parsed.end;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
