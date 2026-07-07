import { signal } from '@weave-framework/runtime';
import GridList from '@weave-framework/ui/grid-list';

// Capitalized tags in the template resolve to this import.
void GridList;

interface Photo {
  id: number;
  label: string;
  featured: boolean;
}

interface Setup {
  photos: () => Photo[];
}

/** Data-driven: a keyed `@for` fills the grid, flagging one tile as the accent. */
export function setup(): Setup {
  const photos = signal<Photo[]>([
    { id: 1, label: 'Sunrise', featured: true },
    { id: 2, label: 'Harbour', featured: false },
    { id: 3, label: 'Ridge', featured: false },
    { id: 4, label: 'Meadow', featured: false },
    { id: 5, label: 'Dunes', featured: false },
    { id: 6, label: 'Falls', featured: false },
  ]);
  return { photos };
}
