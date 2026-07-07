import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  role: string;
}
interface ColumnResize {
  key: string;
  width: number;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
  widths: () => Record<string, number>;
  onResize: (e: ColumnResize) => void;
}

/**
 * `resizableColumns` adds a drag grip to every header (per-column `resizable` + `minWidth` also
 * work). Here the widths are controlled via `columnWidths` + `onColumnResize` — drag a grip, or
 * focus it and press Arrow keys.
 */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', role: 'Lead' },
    { id: 2, name: 'Rūta', role: 'Design' },
    { id: 3, name: 'Marius', role: 'Backend' },
    { id: 4, name: 'Ona', role: 'Frontend' },
  ];
  const columns = [
    { key: 'name', header: 'Name', width: 160, minWidth: 80 },
    { key: 'role', header: 'Role', width: 160 },
  ];
  const widths = signal<Record<string, number>>({ name: 160, role: 160 });
  const onResize = (e: ColumnResize): void => widths.set({ ...widths(), [e.key]: e.width });
  return { rows, columns, trackBy: (r) => r.id, widths, onResize };
}
