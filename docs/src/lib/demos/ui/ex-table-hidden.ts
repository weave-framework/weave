import { signal, computed } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to these imports.
void Table;
void Checkbox;

interface Row {
  id: number;
  name: string;
  role: string;
  commits: number;
}
interface Setup {
  rows: Row[];
  columns: () => unknown[];
  trackBy: (r: Row) => number;
  showCommits: () => boolean;
  onToggle: (checked: boolean) => void;
}

/**
 * `hidden` drops a column from the render. When `columns` is bound to a signal it's reactive —
 * flip the checkbox to show/hide the Commits column live.
 */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', role: 'Lead', commits: 128 },
    { id: 2, name: 'Rūta', role: 'Design', commits: 74 },
    { id: 3, name: 'Marius', role: 'Backend', commits: 203 },
    { id: 4, name: 'Ona', role: 'Frontend', commits: 96 },
  ];
  const showCommits = signal(true);
  const columns = computed(() => [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
    { key: 'commits', header: 'Commits', numeric: true, hidden: !showCommits() },
  ]);
  return { rows, columns, trackBy: (r) => r.id, showCommits, onToggle: (checked) => showCommits.set(checked) };
}
