import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  role: string;
  bio: string;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
  detail: (r: Row) => string;
}

/** `expandable` adds a chevron column; `detail` renders a full-width row under the expanded one. */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', role: 'Lead', bio: 'Signals, compiler, and coffee.' },
    { id: 2, name: 'Rūta', role: 'Design', bio: 'Owns the design system tokens.' },
    { id: 3, name: 'Marius', role: 'Backend', bio: 'Keeps the data sources fast.' },
  ];
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
  ];
  return { rows, columns, trackBy: (r) => r.id, detail: (r) => r.bio };
}
