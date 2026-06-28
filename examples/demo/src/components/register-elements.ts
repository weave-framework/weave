/**
 * Register Weave components as native custom elements. Imported for its side effect
 * from main.ts, before the app mounts, so `<weave-badge>` is defined when TaskCard
 * first renders one.
 */

import { defineCustomElement } from '@weave/runtime/dom';
import Badge from './weave-badge';

defineCustomElement('weave-badge', Badge, { props: ['priority'] });
