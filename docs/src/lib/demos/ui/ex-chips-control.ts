import { field, type Field } from '@weave-framework/forms';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: Field<string[]>;
  touched: () => boolean;
}

/**
 * `control` binds a forms `Field<string[]>` — it drives the array two-way and marks
 * `touched` when a chip is removed. `control` wins over `value`.
 */
export function setup(): Setup {
  const tags = field<string[]>(['alpha', 'beta', 'gamma']);
  return { tags, touched: () => tags.touched() };
}
