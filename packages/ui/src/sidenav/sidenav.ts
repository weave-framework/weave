/**
 * `<Sidenav>` — the responsive layout shell: a `__drawer` beside a `__content`, in one of
 * three modes:
 *
 * - **`side`** — the drawer is in flow and pushes the content (always-visible on wide screens).
 * - **`over`** — the drawer floats over the content with a dimming backdrop; it becomes a focus
 *   context (focus-trap in, Esc + backdrop-click close). This is the off-canvas mobile drawer.
 * - **`push`** — the drawer floats but also shifts the content over by its width (both slide).
 *
 * **Responsive:** omit `mode` and the Sidenav consumes the CDK `breakpointSignal` — below the
 * Weave `Narrow` breakpoint (900px) it auto-switches to `over` + closed; above, `side` + open.
 * This fulfils the off-canvas drawer deferred from the U2 Toolbar (a Toolbar hamburger toggles it).
 *
 * **Open state** is the Weave convention: controlled `opened` (getter) + `onOpenedChange`, OR
 * uncontrolled `defaultOpened`. Imperative `open()`/`close()`/`toggle()` are exposed via the
 * `api` ref callback (like Input's `onInputRef`).
 *
 *   import Sidenav from '@weave-framework/ui/sidenav';
 *   <Sidenav opened={{ nav() }} onOpenedChange={{ nav.set }}>
 *     <nav slot="drawer">…links…</nav>
 *     <main>…page…</main>
 *   </Sidenav>
 */
import { signal, effect, onMount, onDispose, type Signal } from '@weave-framework/runtime';
import { breakpointSignal, matchesBreakpoint, Breakpoints, focusTrap, type FocusTrap } from '../cdk/index.js';

/** The drawer layout mode. Omit to derive it responsively from the breakpoint. */
export type SidenavMode = 'side' | 'over' | 'push';

/** Imperative handle exposed via the `api` ref callback. */
export interface SidenavApi {
  open(): void;
  close(): void;
  toggle(): void;
  /** Reactive — the current open state. */
  opened(): boolean;
}

export interface SidenavProps {
  /** Fixed mode. Omit for responsive behaviour (over+closed when narrow, side+open when wide). */
  mode?: SidenavMode;
  /** Controlled open state (a getter). Ignored for the internal state when omitted. */
  opened?: boolean;
  /** Called with the next open state whenever it changes (backdrop/Esc/api/responsive). */
  onOpenedChange?: (opened: boolean) => void;
  /** Uncontrolled initial open state (explicit mode only; responsive mode derives it). */
  defaultOpened?: boolean;
  /** Which edge the drawer docks to. Default `'start'`. */
  position?: 'start' | 'end';
  /** The media query that drives responsive mode. Default the Weave `Narrow` breakpoint (900px). */
  breakpoint?: string;
  /** Force the backdrop on/off. Default: shown only in `over` mode. */
  backdrop?: boolean;
  /** Receives the imperative `{ open, close, toggle, opened }` handle once mounted. */
  api?: (api: SidenavApi) => void;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }} on:keydown={{ onKeydown }}>' +
  '<aside class="weave-sidenav__drawer" ref={{ drawer }} aria-modal={{ drawerModal() }}><slot name="drawer"></slot></aside>' +
  '<div class="weave-sidenav__backdrop" aria-hidden="true" on:click={{ onBackdropClick }}></div>' +
  '<div class="weave-sidenav__content"><slot></slot></div>' +
  '</div>';

export interface SidenavContext {
  root: Signal<HTMLElement | null>;
  drawer: Signal<HTMLElement | null>;
  rootClass: () => string;
  drawerModal: () => 'true' | undefined;
  onKeydown: (event: KeyboardEvent) => void;
  onBackdropClick: () => void;
}

export function setup(props: SidenavProps): SidenavContext {
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const drawer: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);

  const bp: string = props.breakpoint ?? Breakpoints.Narrow;
  const narrow: () => boolean = breakpointSignal(bp);

  const autoMode = (): boolean => props.mode === undefined;
  const effectiveMode = (): SidenavMode => props.mode ?? (narrow() ? 'over' : 'side');
  const controlled = (): boolean => props.opened !== undefined;

  // Uncontrolled state — seeded correctly so the first paint doesn't flash (auto mode reads
  // the breakpoint now; explicit mode honours `defaultOpened`).
  const openState: Signal<boolean> = signal<boolean>(
    autoMode() ? !matchesBreakpoint(bp) : props.defaultOpened ?? true,
  );
  const opened = (): boolean => (controlled() ? !!props.opened : openState());

  const setOpened = (next: boolean): void => {
    if (!controlled()) openState.set(next);
    props.onOpenedChange?.(next);
  };

  // Responsive auto open/close — only in auto mode + uncontrolled, and only reacts to an
  // actual breakpoint crossing (the effect re-runs when `narrow()` flips, not on manual toggles).
  effect(() => {
    const isNarrow: boolean = narrow();
    if (!autoMode() || controlled()) return;
    openState.set(!isNarrow);
  });

  const backdropActive = (): boolean => props.backdrop ?? effectiveMode() === 'over';

  // In `over` mode the open drawer is a modal focus context: trap focus, restore on close.
  // Gated on `mounted` so the first activation happens AFTER the root is in the document
  // (focusing a detached element is a no-op that would wrongly latch trapOn).
  const mounted: Signal<boolean> = signal<boolean>(false);
  let trap: FocusTrap | null = null;
  let trapOn: boolean = false;
  effect(() => {
    const d: HTMLElement | null = drawer();
    const shouldTrap: boolean = mounted() && !!d && effectiveMode() === 'over' && opened();
    if (shouldTrap && !trapOn) {
      trap ??= focusTrap(d as HTMLElement, { restoreFocus: true });
      trap.activate();
      trapOn = true;
    } else if (!shouldTrap && trapOn) {
      trap?.deactivate();
      trapOn = false;
    }
  });
  onDispose(() => trap?.deactivate());

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && effectiveMode() === 'over' && opened()) {
      event.preventDefault();
      setOpened(false);
    }
  };

  const onBackdropClick = (): void => setOpened(false);

  onMount(() => {
    mounted.set(true);
    props.api?.({
      open: () => setOpened(true),
      close: () => setOpened(false),
      toggle: () => setOpened(!opened()),
      opened,
    });
  });

  return {
    root,
    drawer,
    rootClass: (): string => {
      const parts: string[] = ['weave-sidenav', `weave-sidenav--${effectiveMode()}`];
      if (opened()) parts.push('weave-sidenav--opened');
      if (props.position === 'end') parts.push('weave-sidenav--end');
      if (backdropActive() && opened()) parts.push('weave-sidenav--backdrop');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    // Declare modality to AT while the over-mode drawer is open (it already traps focus + Esc-closes).
    drawerModal: (): 'true' | undefined => (effectiveMode() === 'over' && opened() ? 'true' : undefined),
    onKeydown,
    onBackdropClick,
  };
}
