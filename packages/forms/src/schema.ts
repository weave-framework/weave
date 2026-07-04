/**
 * @weave-framework/forms/schema — schema-driven forms.
 *
 * A declarative **field-type registry** ({@link fieldType}) plus a builder
 * ({@link schemaForm}) that turns a plain JSON-ish schema into a live forms
 * {@link Group}, composing the existing `field`/`group`/`validators` primitives —
 * no re-implementation of form state. This is the RFC 0002 "field-type registry"
 * slice: instead of hand-wiring every `field(...)`, you describe fields declaratively
 * and a registered *type* supplies the default value, the validators built from the
 * field's constraints, and a UI-render hint (which control + props).
 *
 * ```ts
 * import { schemaForm, fieldType } from '@weave-framework/forms/schema';
 *
 * const f = schemaForm({
 *   fields: [
 *     { name: 'email', type: 'email', required: true, label: 'Email' },
 *     { name: 'age',   type: 'number', min: 18 },
 *     { name: 'plan',  type: 'select', options: [{ value: 'free', label: 'Free' }] },
 *     { name: 'tos',   type: 'checkbox', required: true },
 *   ],
 * });
 * f.render();        // [{ name, field, control:'input', props:{type:'email'}, label }, …] → drive the UI
 * f.valid();         // aggregate validity, reactive
 * f.value();         // { email, age, plan, tos }, reactive
 * ```
 */

import {
  field,
  group,
  validators,
  type Field,
  type Group,
  type Validator,
  type AsyncValidator,
} from './index';

/* ─────────────────────────────── schema ─────────────────────────────── */

/** One declarative field in a {@link FormSchema}. `type` names a registered {@link FieldTypeDef}. */
export interface SchemaField {
  /** Unique key within the form — becomes the control name and the value key. */
  name: string;
  /** A registered field-type name (built-ins: text, textarea, email, password, number, checkbox, select, radio, date). */
  type: string;
  /** Human label — passed through to the render descriptor for the UI to show. */
  label?: string;
  /** Explicit initial value; falls back to the type's default. */
  initial?: unknown;
  /** Adds a `required` validator (a checkbox must be checked; a value must be non-empty). */
  required?: boolean;
  /** Numeric lower bound (number type). */
  min?: number;
  /** Numeric upper bound (number type). */
  max?: number;
  /** Minimum string length (text-like types). Skipped when the value is empty and not `required`. */
  minLength?: number;
  /** Maximum string length (text-like types). */
  maxLength?: number;
  /** Format the value must match (text-like types). Skipped when empty and not `required`. */
  pattern?: RegExp;
  /** Choices for select/radio — passed through as a render prop. */
  options?: ReadonlyArray<{ value: unknown; label: string }>;
  /** Extra validators appended after the type's constraint-derived ones. */
  validators?: Validator<never>[];
  /** Async validator (e.g. "username taken?") — same semantics as {@link field}'s. */
  asyncValidate?: AsyncValidator<never>;
  /** Debounce for {@link asyncValidate} (ms). */
  debounceMs?: number;
  /** Arbitrary extra props merged into the render descriptor (override the type's props). */
  props?: Record<string, unknown>;
}

/** A whole form described declaratively. */
export interface FormSchema {
  /** The fields, in render order. */
  fields: SchemaField[];
  /** Cross-field validation over the whole `{ name: value }` snapshot — same shape as `group`'s. */
  validate?: (values: Record<string, unknown>) => Record<string, string> | null;
}

/* ──────────────────────────── field types ───────────────────────────── */

/**
 * A field type — the mapping from a schema `type` name to (1) a default value,
 * (2) the validators its constraints translate to, and (3) a UI-render hint. Register
 * one with {@link fieldType}; a `schemaForm` consults the registry (or a per-form
 * override list) to build each control.
 */
export interface FieldTypeDef<T = unknown> {
  /** The `type` name this handles (e.g. `'email'`). */
  name: string;
  /** Default initial value when the schema field omits `initial` — a value or a function of the field. */
  defaultValue?: T | ((f: SchemaField) => T);
  /** Build the validator list from the field's constraints (`required`/`min`/`pattern`/…). */
  validators?: (f: SchemaField) => Validator<T>[];
  /** UI hint — the component key a renderer should use (default `'input'`). */
  control?: string;
  /** UI hint — static props for that component, merged UNDER the field's own `props`. */
  props?: (f: SchemaField) => Record<string, unknown>;
  /** Coerce a raw value to this type (e.g. `''`/`null` → number|null). Applied to the initial value. */
  coerce?: (raw: unknown) => T;
}

const registry: Map<string, FieldTypeDef<unknown>> = new Map<string, FieldTypeDef<unknown>>();

/**
 * Register a field type (and return it). Overrides any existing type of the same name.
 * This is the `fieldType()` registry entry point — call it once at app start for your
 * custom types, or pass types per-form via `schemaForm(schema, { types: [...] })`.
 */
export function fieldType<T>(def: FieldTypeDef<T>): FieldTypeDef<T> {
  registry.set(def.name, def as FieldTypeDef<unknown>);
  return def;
}

/** Look up a registered field type by name (undefined if none). */
export function getFieldType(name: string): FieldTypeDef<unknown> | undefined {
  return registry.get(name);
}

/** The names of every currently-registered field type. */
export function fieldTypeNames(): string[] {
  return [...registry.keys()];
}

/* ─────────────────────── built-in field types ───────────────────────── */

/** Wrap a string validator so it is skipped on an empty value (emptiness is `required`'s job). */
const skipEmpty =
  (v: Validator<string>): Validator<string> =>
  (x) =>
    x ? v(x) : null;

/** required + minLength/maxLength/pattern from a schema field, for text-like types. */
function textValidators(f: SchemaField): Validator<string>[] {
  const vs: Validator<string>[] = [];
  if (f.required) vs.push(validators.required() as Validator<string>);
  if (f.minLength != null) vs.push(skipEmpty(validators.minLength(f.minLength)));
  if (f.maxLength != null) vs.push(validators.maxLength(f.maxLength));
  if (f.pattern) vs.push(skipEmpty(validators.pattern(f.pattern)));
  return vs;
}

fieldType<string>({ name: 'text', control: 'input', defaultValue: '', validators: textValidators });
fieldType<string>({ name: 'textarea', control: 'textarea', defaultValue: '', validators: textValidators });
fieldType<string>({
  name: 'email',
  control: 'input',
  defaultValue: '',
  props: () => ({ type: 'email' }),
  validators: (f) => [...textValidators(f), skipEmpty(validators.email())],
});
fieldType<string>({
  name: 'password',
  control: 'input',
  defaultValue: '',
  props: () => ({ type: 'password' }),
  validators: textValidators,
});
fieldType<string>({ name: 'date', control: 'date', defaultValue: '', validators: textValidators });

fieldType<number | null>({
  name: 'number',
  control: 'number',
  defaultValue: null,
  coerce: (raw) => (raw === '' || raw == null ? null : Number(raw)),
  validators: (f) => {
    const vs: Validator<number | null>[] = [];
    if (f.required) vs.push((v) => (v == null ? 'Required' : null));
    if (f.min != null) vs.push((v) => (v != null && v < f.min! ? `Must be ≥ ${f.min}` : null));
    if (f.max != null) vs.push((v) => (v != null && v > f.max! ? `Must be ≤ ${f.max}` : null));
    return vs;
  },
});

fieldType<boolean>({
  name: 'checkbox',
  control: 'checkbox',
  defaultValue: false,
  coerce: (raw) => Boolean(raw),
  validators: (f) => (f.required ? [validators.required() as Validator<boolean>] : []),
});

const choiceType = (name: string): void => {
  fieldType<unknown>({
    name,
    control: name,
    defaultValue: '',
    props: (f) => ({ options: f.options ?? [] }),
    validators: (f) => (f.required ? [validators.required()] : []),
  });
};
choiceType('select');
choiceType('radio');

/* ──────────────────────────── the builder ───────────────────────────── */

/** One entry of {@link SchemaForm.render} — the live control plus the UI hints to render it. */
export interface RenderField {
  /** The field name / value key. */
  name: string;
  /** The live {@link Field} — bind `value`, read `error()`/`valid()`. */
  field: Field<unknown>;
  /** The originating schema field. */
  schema: SchemaField;
  /** Which UI component to render (the type's `control`, default `'input'`). */
  control: string;
  /** The field's label, if any. */
  label?: string;
  /** Props for the component: the type's `props` overlaid with the field's own `props`. */
  props: Record<string, unknown>;
}

/** The result of {@link schemaForm}: a `group` of fields plus the render model + lookups. */
export interface SchemaForm extends Group<Record<string, Field<unknown>>> {
  /** The schema it was built from. */
  schema: FormSchema;
  /** Ordered render descriptors — iterate these to render the form. */
  render: () => RenderField[];
  /** Look up one field by name. */
  fieldFor: (name: string) => Field<unknown> | undefined;
}

/**
 * Build a live form from a declarative {@link FormSchema}. Each field is created via its
 * registered {@link FieldTypeDef} (default value, constraint validators, render hint), then
 * aggregated with the existing {@link group} (so validity/values/touched/dirty/submit all
 * work exactly as a hand-built form). Pass `types` to register field types scoped to this
 * form (they win over globally-registered ones without mutating the global registry).
 *
 * Throws (fail-loud) if a field names a `type` that isn't registered.
 */
export function schemaForm(schema: FormSchema, opts: { types?: FieldTypeDef<unknown>[] } = {}): SchemaForm {
  const local: Map<string, FieldTypeDef<unknown>> = new Map<string, FieldTypeDef<unknown>>();
  for (const t of opts.types ?? []) local.set(t.name, t);
  const resolve = (name: string): FieldTypeDef<unknown> | undefined => local.get(name) ?? registry.get(name);

  const controls: Record<string, Field<unknown>> = {};
  const descriptors: RenderField[] = [];

  for (const f of schema.fields) {
    const def: FieldTypeDef<unknown> | undefined = resolve(f.type);
    if (!def) {
      throw new Error(
        `[weave/forms] unknown field type "${f.type}" for field "${f.name}". ` +
          `Register it with fieldType({ name: '${f.type}', … }) or pass it via schemaForm(schema, { types: [ … ] }).`
      );
    }
    const rawInitial: unknown =
      f.initial !== undefined
        ? f.initial
        : typeof def.defaultValue === 'function'
          ? (def.defaultValue as (x: SchemaField) => unknown)(f)
          : def.defaultValue;
    const initial: unknown = def.coerce ? def.coerce(rawInitial) : rawInitial;
    const vs: Validator<unknown>[] = [
      ...(def.validators ? (def.validators(f) as Validator<unknown>[]) : []),
      ...((f.validators as Validator<unknown>[] | undefined) ?? []),
    ];
    const control: Field<unknown> = field<unknown>(initial, vs, {
      asyncValidate: f.asyncValidate as AsyncValidator<unknown> | undefined,
      debounceMs: f.debounceMs,
    });
    controls[f.name] = control;
    descriptors.push({
      name: f.name,
      field: control,
      schema: f,
      control: def.control ?? 'input',
      label: f.label,
      props: { ...(def.props ? def.props(f) : {}), ...(f.props ?? {}) },
    });
  }

  const g: SchemaForm = group(controls, schema.validate ? { validate: (v) => schema.validate!(v) } : {}) as SchemaForm;
  g.schema = schema;
  g.render = () => descriptors;
  g.fieldFor = (name) => controls[name];
  return g;
}
