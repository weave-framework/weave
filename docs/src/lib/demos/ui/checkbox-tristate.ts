import { signal, computed } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

// Capitalized tags in the template resolve to this import.
void Checkbox;

interface Setup {
  email: () => boolean;
  sms: () => boolean;
  setEmail: (v: boolean) => void;
  setSms: (v: boolean) => void;
  allOn: () => boolean;
  indeterminate: () => boolean;
  toggleAll: (v: boolean) => void;
}

/** A "select all" parent whose `indeterminate` derives from its children. */
export function setup(): Setup {
  const email = signal(true);
  const sms = signal(false);
  const allOn = computed(() => email() && sms());
  const indeterminate = computed(() => (email() || sms()) && !allOn());
  const toggleAll = (v: boolean): void => {
    email.set(v);
    sms.set(v);
  };
  return {
    email,
    sms,
    setEmail: (v) => email.set(v),
    setSms: (v) => sms.set(v),
    allOn,
    indeterminate,
    toggleAll,
  };
}
