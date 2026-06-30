import type { Component } from '@weave/runtime/dom';
import CounterDemo from '../demos/counter-demo';

/**
 * Live-demo registry: maps a `:::demo <key>` directive to a real Weave component.
 * The renderer instantiates the component so the example actually runs on the page.
 * Add a demo here and reference it by key from any markdown page.
 */
export const demos: Record<string, Component> = {
  counter: CounterDemo,
};
