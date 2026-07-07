import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface Setup {
  options: { value: string; label: string }[];
}

/** `disabled` greys the field and stops the suggestion panel from opening. */
export function setup(): Setup {
  const options = [
    { value: 'ng', label: 'Angular' },
    { value: 'rc', label: 'React' },
    { value: 'wv', label: 'Weave' },
  ];
  return { options };
}
