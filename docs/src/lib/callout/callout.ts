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
}

/** A highlighted aside — notes, tips, and warnings. Body is the default slot. */
export function setup(props: CalloutProps): CalloutSetup {
  return {
    kind: () => props.kind ?? 'info',
    title: () => props.title ?? '',
    hasTitle: () => !!props.title,
  };
}
