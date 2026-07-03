import Icon from '@weave-framework/ui/icon';

// `<Icon>` (Lucide) is composed in the template — the kind's glyph.
void Icon;

/** Lucide icon per flavor (all in the built-in @weave-framework/ui set). */
const ICONS: Record<string, string> = {
  info: 'info',
  tip: 'circle-check',
  warn: 'triangle-alert',
};

interface CalloutProps {
  /** Visual flavor: 'info' (default), 'tip', or 'warn'. */
  kind?: string;
  /** Optional bold heading above the body. */
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
  const kind = (): string => props.kind ?? 'info';
  return {
    kind,
    title: () => props.title ?? '',
    hasTitle: () => !!props.title,
    iconName: () => ICONS[kind()] ?? ICONS.info,
  };
}
