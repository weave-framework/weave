import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to these imports.
void Table;
void Checkbox;

interface Row {
  id: number;
  name: string;
  role: string;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
  picked: () => string;
  onSel: (selected: Row[]) => void;
}

/** Single selection — picking a row replaces the previous one; no header select-all. */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', role: 'Lead' },
    { id: 2, name: 'Rūta', role: 'Design' },
    { id: 3, name: 'Marius', role: 'Backend' },
    { id: 4, name: 'Ona', role: 'Frontend' },
  ];
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
  ];
  const picked = signal('(none)');
  return { rows, columns, trackBy: (r) => r.id, picked, onSel: (selected) => picked.set(selected[0]?.name ?? '(none)') };
}
