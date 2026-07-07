import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to this import.
void Icon;

interface Setup {
  url: string;
}

/** `src` fetches a standalone `.svg` file and renders it (sanitised). */
export function setup(): Setup {
  // A self-contained data: URL stands in for a real file path like '/icons/brand.svg'.
  const url =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    );
  return { url };
}
