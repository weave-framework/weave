import type { Component } from '@weave-framework/runtime/dom';
import CounterDemo from '../demos/counter-demo';
import ButtonEvents from '../demos/ui/button-events';
import ButtonVariants from '../demos/ui/button-variants';
import ButtonDisabled from '../demos/ui/button-disabled';

/**
 * Live-demo registry: maps a `:::demo <key>` directive to a real Weave component.
 * The renderer instantiates the component so the example actually runs on the page.
 * Add a demo here and reference it by key from any markdown page.
 *
 * UI-library demos (keys prefixed by component name) import the real
 * `@weave-framework/ui/<component>` and use it exactly as a consumer would.
 */
export const demos: Record<string, Component> = {
  counter: CounterDemo,
  'button-events': ButtonEvents,
  'button-variants': ButtonVariants,
  'button-disabled': ButtonDisabled,
};
