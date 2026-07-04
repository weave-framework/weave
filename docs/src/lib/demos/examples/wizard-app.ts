import { computed, effect, signal } from '@weave-framework/runtime';
import { field, validators, type Field } from '@weave-framework/forms';
import Stepper from '@weave-framework/ui/stepper';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';
import Select from '@weave-framework/ui/select';
import Checkbox from '@weave-framework/ui/checkbox';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to this import.
void Stepper;

const ROLES = [
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'manager', label: 'Product manager' },
  { value: 'other', label: 'Something else' },
];
const roleLabel = (v: string): string => ROLES.find((r) => r.value === v)?.label ?? v;

interface Setup {
  steps: () => { label: string; content: () => Node; completed: boolean }[];
  step: () => number;
  setStep: (i: number) => void;
  complete: () => void;
}

/** A linear sign-up wizard driven by @weave-framework/forms field validity. */
export function setup(): Setup {
  // The form model — each field carries its own validators; `error()`/`valid()` derive.
  const email = field('', [validators.required('Email is required'), validators.email()]);
  const password = field('', [validators.required('Password is required'), validators.minLength(8, 'At least 8 characters')]);
  const fullName = field('', [validators.required('Your name is required')]);
  const role = field('developer');
  const terms = field(false, [validators.required('You must accept the terms to continue')]);

  // Step validity — plain `computed`s combining the relevant fields.
  const accountValid = computed(() => email.valid() && password.valid());
  const profileValid = computed(() => fullName.valid() && role.valid());
  const reviewValid = computed(() => terms.valid());

  // A labelled control bound to a forms Field via `control` — two-way value,
  // touched-on-blur, and the error line all come from the field.
  const textField = (f: Field<string>, label: string, type?: string): Node =>
    FormField({ label, control: f }, { default: () => Input({ control: f, type }) });

  const accountPanel = (): Node => {
    const wrap = document.createElement('div');
    wrap.className = 'wizard__fields';
    wrap.append(textField(email, 'Email', 'email'), textField(password, 'Password', 'password'));
    return wrap;
  };

  const profilePanel = (): Node => {
    const wrap = document.createElement('div');
    wrap.className = 'wizard__fields';
    wrap.append(
      textField(fullName, 'Full name'),
      FormField({ label: 'Role' }, { default: () => Select({ control: role, options: ROLES }) }),
    );
    return wrap;
  };

  const reviewPanel = (): Node => {
    const wrap = document.createElement('div');
    wrap.className = 'wizard__review';
    const dl = document.createElement('dl');
    dl.className = 'wizard__summary';
    effect(() => {
      const rows: [string, string][] = [
        ['Email', email.value() || '—'],
        ['Name', fullName.value() || '—'],
        ['Role', roleLabel(role.value())],
      ];
      dl.replaceChildren();
      for (const [k, v] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      }
    });
    wrap.append(
      dl,
      FormField(
        { control: terms },
        { default: () => Checkbox({ control: terms, label: 'I accept the terms of service' }) },
      ),
    );
    return wrap;
  };

  const step = signal(0);
  const steps = computed(() => [
    { label: 'Account', content: accountPanel, completed: accountValid() },
    { label: 'Profile', content: profilePanel, completed: profileValid() },
    { label: 'Review', content: reviewPanel, completed: reviewValid() },
  ]);

  const complete = (): void => {
    // Finish isn't gated on the last step in linear mode, so enforce the terms here:
    // touch the field (surfacing its error) and bail if it isn't accepted yet.
    if (!reviewValid()) {
      terms.touchAll();
      return;
    }
    snackbar('Account created — welcome aboard!', { duration: 3500 });
  };

  return { steps, step, setStep: (i) => step.set(i), complete };
}
