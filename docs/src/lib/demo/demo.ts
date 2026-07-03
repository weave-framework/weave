import Card from '@weave-framework/ui/card';

// `<Card>` is referenced in the template.
void Card;

/** A framed stage that shows a *live*, running Weave example. The frame is a real
 *  Weave-UI `<Card>` surface; the example itself is projected as the default slot, so
 *  the very component being documented runs right here on the page — not a screenshot. */
export function setup(): Record<string, never> {
  return {};
}
