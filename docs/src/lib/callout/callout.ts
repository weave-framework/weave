import Icon from '@weave-framework/ui/icon';

// `<Icon>` (Lucide) is composed in the template — the kind's glyph.
void Icon;

/**
 * Lucide icon per flavor (all in the built-in @weave-framework/ui set).
 *
 * Three of these carry the teaching pattern the Learn pages are being rewritten around, and each gets
 * its own colour so a reader can tell them apart before reading a word: what a thing DOES (info, blue),
 * what you will SEE when it runs (see, green), and where people GO WRONG (trap, red). `warn` keeps
 * orange for a genuine hazard, which is a different thing from a common mistake.
 *
 * An unknown kind used to fall back to `info` in silence — `:::callout note` appeared three times and
 * rendered as an info box that nobody noticed was not a `note`. Unknown kinds now say so; see the
 * `hasKind` check below.
 */
const ICONS: Record<string, string> = {
  info: 'info',
  tip: 'circle-check',
  see: 'eye',
  trap: 'circle-alert',
  warn: 'triangle-alert',
};

interface CalloutProps {
  /** Visual flavor: 'info' (default), 'tip', 'see', 'trap', or 'warn'. */
  kind?: string;
  /**
   * Optional bold heading above the body — PLAIN TEXT.
   *
   * A title written with markdown in it reaches the reader literally: 34 titles across 25 pages
   * published their own backticks, because this is set as text. Pass a `title` slot to format one
   * (the markdown renderer does); this string stays the fallback.
   */
  title?: string;
}

interface CalloutSetup {
  kind: () => string;
  title: () => string;
  hasTitle: () => boolean;
  /** The kind's Lucide icon name. */
  iconName: () => string;
}

/** A highlighted aside — notes, tips, and warnings. A light tint of the flavor's colour,
 *  a subtle border, and a matching (richer) icon; the body is the default slot. */
export function setup(props: CalloutProps): CalloutSetup {
  const kind = (): string => {
    const k: string = props.kind ?? 'info';
    if (!(k in ICONS)) {
      // Silence here is how `note` survived: it rendered as an info box and read as intentional.
      console.error(`weave docs: unknown callout kind "${k}" — expected one of ${Object.keys(ICONS).join(', ')}.`);
      return 'info';
    }
    return k;
  };
  return {
    kind,
    title: () => props.title ?? '',
    hasTitle: () => !!props.title,
    iconName: () => ICONS[kind()] ?? ICONS.info,
  };
}
