import { field, validators, type Field } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Slider from '@weave-framework/ui/slider';

// Capitalized tags in the template resolve to these imports.
void FormField;
void Slider;

interface Setup {
  level: Field<number>;
  levelError: () => string;
}

/**
 * `control` binds a forms `Field<number>`: two-way value, `touched` on release, and `aria-invalid`
 * when the field is touched and invalid. Here the level must be at least 20 — drag below it, release,
 * and the error underline plus message appear.
 */
export function setup(): Setup {
  const level = field(10, [validators.min(20, 'Pick at least 20')]);
  const levelError = (): string => (level.touched() ? level.error() ?? '' : '');
  return { level, levelError };
}
