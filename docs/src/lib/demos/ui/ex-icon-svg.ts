import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to this import.
void Icon;

interface Setup {
  mySvg: string;
}

/** `svg` renders a complete inline `<svg>` string directly, bypassing the registry (sanitised). */
export function setup(): Setup {
  const mySvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>';
  return { mySvg };
}
