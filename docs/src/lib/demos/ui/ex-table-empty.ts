import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  role: string;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
}

/** An empty dataSource renders a single full-width row with `emptyText`. `class` adds a hook. */
export function setup(): Setup {
  const rows: Row[] = [];
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role' },
  ];
  return { rows, columns };
}
