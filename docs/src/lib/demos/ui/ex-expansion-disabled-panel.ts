import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string; disabled?: boolean }[];
}

/** Per-panel disabled — the middle panel is not toggleable and skipped in keyboard nav. */
export function setup(): Setup {
  const panels = [
    { id: 'free', header: 'Free plan', body: 'Everything you need to get started.' },
    { id: 'pro', header: 'Pro plan (coming soon)', body: 'Locked for now.', disabled: true },
    { id: 'team', header: 'Team plan', body: 'Shared workspaces and admin controls.' },
  ];
  return { panels };
}
