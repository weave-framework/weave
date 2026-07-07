import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to these imports.
// Table composes the real <Checkbox> for its selection column.
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
  count: () => number;
  onSel: (selected: Row[]) => void;
}

/** Multiple selection — a leading checkbox column + a header select-all (tri-state). */
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
  const count = signal(0);
  return { rows, columns, trackBy: (r) => r.id, count, onSel: (selected) => count.set(selected.length) };
}
