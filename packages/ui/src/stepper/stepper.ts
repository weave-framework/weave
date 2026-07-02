/**
 * `<Stepper>` — a horizontal step-through (wizard).
 *
 * A row of numbered circles + labels joined by connector lines: a **done** step is an
 * accent circle with a ✓, the **active** step is an accent circle with its number, an
 * **upcoming** step is a bordered circle. Below the header, the active step's content is
 * shown (all steps stay mounted so per-step form state survives navigation); built-in
 * **Back / Continue** buttons drive it (Continue becomes **Finish** on the last step).
 *
 * Steps are an items-prop (`steps`); each step's **content is arbitrary** — a `Node`, a
 * string, or a factory `() => Node`. Current step = the **index** (design), controlled via
 * `value` + `onChange` or uncontrolled from `defaultIndex`.
 *
 * **Linear vs non-linear** (`linear`, default false): non-linear lets you click any step;
 * linear only lets you go back or jump forward through a fully-`completed` prefix, and
 * Continue is gated on the current step being `completed` (or `optional`). A step's
 * `completed` flag is the consumer's to set — wire it to a forms `Field`'s validity so
 * the ui stays decoupled from forms (same philosophy as the Checkbox `control` prop).
 *
 *   import Stepper from '@weave-framework/ui/stepper';
 *   <Stepper steps={{ steps }} value={{ step() }} onChange={{ setStep }} linear={{ true }} />
 */

import { signal, onMount, type Signal } from '@weave-framework/runtime';

/** A step panel's content: a DOM node, a plain string, or a factory returning a node. */
export type StepContent = Node | string | (() => Node);

export interface StepItem {
  /** Step label text. */
  label: string;
  /** Panel content, shown when this step is active. */
  content: StepContent;
  /** Marks the step complete (drives the ✓ + linear gating). Wire to form validity. */
  completed?: boolean;
  /** Optional step — Continue isn't gated on it in linear mode. */
  optional?: boolean;
  /** Disable this step (not navigable). */
  disabled?: boolean;
}

export interface StepperProps {
  /** The steps, left to right. */
  steps: StepItem[];
  /** Controlled current index. */
  value?: number;
  /** Called with the next index on navigation. */
  onChange?: (index: number) => void;
  /** Uncontrolled initial index (ignored when `value` is provided). Default 0. */
  defaultIndex?: number;
  /** Linear mode — forward nav only through completed steps. Default false. */
  linear?: boolean;
  /** Fired when Finish is pressed on the last step. */
  onComplete?: () => void;
  /** Show the built-in Back / Continue buttons. Default true. */
  showNav?: boolean;
  /** Disable the whole stepper. */
  disabled?: boolean;
  /** Accessible name for the step list. */
  label?: string;
  /** Button labels (defaults: Back / Continue / Finish). */
  backLabel?: string;
  continueLabel?: string;
  finishLabel?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ host }}>' +
  '<div class="weave-stepper__header" role="list" aria-label={{ label() }}>' +
  '@for (step of steps(); track $index) {' +
  '<button class="weave-stepper__step" type="button" role="listitem" id={{ stepId($index) }}' +
  ' data-state={{ stepStateAttr($index) }} aria-current={{ currentAttr($index) }}' +
  ' aria-disabled={{ navDisabledAttr($index) }} on:click={{ () => goTo($index) }}>' +
  '<span class="weave-stepper__indicator"><span class="weave-stepper__number">{{ $index + 1 }}</span></span>' +
  '<span class="weave-stepper__label">{{ step.label }}' +
  '@if (step.optional) {<span class="weave-stepper__optional">Optional</span>}' +
  '</span>' +
  '</button>' +
  '@if (!$last) {<span class="weave-stepper__connector" data-state={{ connectorStateAttr($index) }}></span>}' +
  '}' +
  '</div>' +
  '@for (step of steps(); track $index) {' +
  '<div class="weave-stepper__panel" role="region" id={{ panelId($index) }}' +
  ' aria-labelledby={{ stepId($index) }} .hidden={{ isHidden($index) }}></div>' +
  '}' +
  '@if (showNav()) {' +
  '<div class="weave-stepper__actions">' +
  '<Button variant="outline" disabled={{ backDisabled() }} on:click={{ back }}>{{ backText() }}</Button>' +
  '<Button disabled={{ nextDisabled() }} on:click={{ next }}>{{ nextText() }}</Button>' +
  '</div>' +
  '}' +
  '</div>';

export interface StepperContext {
  host: Signal<Element | null>;
  steps: () => StepItem[];
  rootClass: () => string;
  label: () => string | undefined;
  stepId: (index: number) => string;
  panelId: (index: number) => string;
  stepStateAttr: (index: number) => string;
  connectorStateAttr: (index: number) => string;
  currentAttr: (index: number) => string | undefined;
  navDisabledAttr: (index: number) => string | undefined;
  isHidden: (index: number) => boolean;
  showNav: () => boolean;
  backText: () => string;
  nextText: () => string;
  backDisabled: () => boolean;
  nextDisabled: () => boolean;
  goTo: (index: number) => void;
  back: () => void;
  next: () => void;
}

let _uid: number = 0;

function toNode(content: StepContent): Node {
  if (typeof content === 'function') return content();
  if (typeof content === 'string') return document.createTextNode(content);
  return content;
}

export function setup(props: StepperProps): StepperContext {
  const host: Signal<Element | null> = signal<Element | null>(null);
  const uid: number = (_uid += 1);
  const uncontrolled: Signal<number> = signal<number>(props.defaultIndex ?? 0);

  const steps = (): StepItem[] => props.steps ?? [];
  const current = (): number => (props.value !== undefined ? props.value : uncontrolled());
  const linear = (): boolean => !!props.linear;
  const lastIndex = (): number => steps().length - 1;

  const stepId = (index: number): string => `weave-stepper-${uid}-step-${index}`;
  const panelId = (index: number): string => `weave-stepper-${uid}-panel-${index}`;

  const isCompleted = (index: number): boolean => steps()[index]?.completed === true;
  // Visual "done": explicitly completed, or a step already passed.
  const isDone = (index: number): boolean => isCompleted(index) || index < current();
  const isStepDisabled = (index: number): boolean => !!props.disabled || !!steps()[index]?.disabled;

  // Linear reachability: back is always allowed; forward only through a completed prefix.
  const canReach = (index: number): boolean => {
    if (isStepDisabled(index)) return false;
    if (!linear() || index <= current()) return true;
    for (let j: number = current(); j < index; j += 1) {
      if (!isCompleted(j) && !steps()[j]?.optional) return false;
    }
    return true;
  };

  const setCurrent = (index: number): void => {
    if (index === current()) return;
    if (props.value === undefined) uncontrolled.set(index);
    props.onChange?.(index);
  };

  const goTo = (index: number): void => {
    if (!canReach(index)) return;
    setCurrent(index);
  };

  const back = (): void => {
    if (current() > 0) setCurrent(current() - 1);
  };

  // Continue advances (gated in linear on the current step); Finish fires onComplete.
  const canAdvance = (): boolean =>
    !linear() || isCompleted(current()) || !!steps()[current()]?.optional;

  const next = (): void => {
    if (current() < lastIndex()) {
      if (canAdvance()) setCurrent(current() + 1);
    } else {
      props.onComplete?.();
    }
  };

  // Step panels are arbitrary content — append them into their panels once in the DOM.
  onMount(() => {
    const el: Element | null = host();
    if (!el) return;
    const panels: NodeListOf<HTMLElement> = el.querySelectorAll<HTMLElement>('.weave-stepper__panel');
    steps().forEach((step, i) => {
      panels[i]?.append(toNode(step.content));
    });
  });

  return {
    host,
    steps,
    rootClass: (): string => (props.class ? `weave-stepper ${props.class}` : 'weave-stepper'),
    label: (): string | undefined => props.label,
    stepId,
    panelId,
    stepStateAttr: (index): string => (index === current() ? 'active' : isDone(index) ? 'done' : 'upcoming'),
    connectorStateAttr: (index): string => (index < current() ? 'done' : 'upcoming'),
    currentAttr: (index): string | undefined => (index === current() ? 'step' : undefined),
    navDisabledAttr: (index): string | undefined => (canReach(index) ? undefined : 'true'),
    isHidden: (index): boolean => index !== current(),
    showNav: (): boolean => props.showNav !== false,
    backText: (): string => props.backLabel ?? 'Back',
    nextText: (): string =>
      current() >= lastIndex() ? props.finishLabel ?? 'Finish' : props.continueLabel ?? 'Continue',
    backDisabled: (): boolean => !!props.disabled || current() === 0,
    nextDisabled: (): boolean => !!props.disabled || (current() < lastIndex() && !canAdvance()),
    goTo,
    back,
    next,
  };
}
