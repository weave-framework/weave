/**
 * `@weave-framework/ui/cdk` — the two-way value binding a `control` prop asks for.
 *
 * Every `control`-taking component (datepicker, timepicker, date-range picker) declared its binding
 * as `Signal<X | null | undefined>`, and a `Signal` is INVARIANT — it can be read and written, so a
 * `Signal<Date | null>` is not one of those. The result was that the binding each component's own
 * documentation recommends, `control={{ someField }}` with a `field<Date | null>(null)`, did not
 * type-check. The most ordinary line in the API was the one that failed.
 *
 * Splitting the read from the write says what is actually true, measured from the components: they
 * READ tolerantly (a value may be missing) and WRITE narrowly (they only ever put back a real value
 * or `null`). Stated that way, both a `Field<Date | null>` and a `Field<Date | null | undefined>`
 * satisfy it — and so does any hand-written object with the same two members.
 */

/** A value that can be read as `R` and written as `W`. A `Signal<W>` is one; so is a form `Field`'s. */
export interface ControlValue<R, W = R> {
  /** Read the current value. Reactive — call it inside an effect and you track it. */
  (): R;
  /** Write the next value. */
  set: (next: W) => unknown;
}
