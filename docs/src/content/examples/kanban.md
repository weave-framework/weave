# Kanban board

The most tactile example: cards you can grab and reorder. This board leans on the Weave CDK's headless
**drag & drop** primitive — `dropList` makes a container's children reorderable with the pointer *and* the
keyboard, and you apply the result with `moveItemInArray`. Everything else is [`Card`](/ui/card),
[`Badge`](/ui/badge), and a couple of [`Button`](/ui/button)s.

:::demo examples-kanban

**Drag a card by its grip** (⠿) to reorder it within a lane. Use the **‹ ›** arrows to move a card to the previous
or next lane. The lane counts keep themselves in sync.

## What it shows

- **Headless drag & drop** — `dropList` from `@weave-framework/ui/cdk` attaches to a plain container and turns its
  children into a reorderable list; `moveItemInArray` applies the drop to your array.
- **A drag handle** — passing `handle: '.kanban__grip'` means only the grip starts a drag, so the arrow buttons on
  a card still click normally.
- **State per lane** — each lane is its own `signal<Ticket[]>`; reordering and lane-moves are just array updates,
  and the keyed `@for` reconciles the DOM.
- **Behaviour, not chrome** — the CDK gives you the *mechanics* (pointer capture, insertion index, keyboard DnD);
  the look is entirely your own CSS.

## The board state

Three lanes, three signals. That's the whole model — a ticket is a plain object, and a lane is an array of them.

:::tabs
~~~ts title="app.ts (state)"
import { signal } from '@weave-framework/runtime';

type LaneId = 'todo' | 'doing' | 'done';
interface Ticket { id: number; title: string; priority: 'low' | 'med' | 'high'; tags: string[] }

const LANES: LaneId[] = ['todo', 'doing', 'done'];

export function setup() {
  const lanes: Record<LaneId, ReturnType<typeof signal<Ticket[]>>> = {
    todo: signal([/* …tickets… */]),
    doing: signal([/* … */]),
    done: signal([/* … */]),
  };
  // …refs + wiring below…
}
~~~
:::

## Wiring the drag & drop

Each lane body gets a `ref`, and once it's in the DOM (`onMount`) you attach a `dropList` to it. The `onDrop`
callback hands you `previousIndex` and `currentIndex`; `moveItemInArray` turns that into the reordered array, which
you set back on the lane's signal.

:::tabs
~~~ts title="app.ts (drag & drop)"
import { onMount } from '@weave-framework/runtime';
import { dropList, moveItemInArray } from '@weave-framework/ui/cdk';

// one ref per lane body
const todoBody = signal<HTMLElement | null>(null);
// …doingBody, doneBody…
const bodies = { todo: todoBody, doing: doingBody, done: doneBody };

onMount(() => {
  for (const lane of LANES) {
    const el = bodies[lane]();
    if (!el) continue;
    dropList(el, {
      handle: '.kanban__grip',
      onDrop: ({ previousIndex, currentIndex }) => {
        lanes[lane].set(moveItemInArray(lanes[lane](), previousIndex, currentIndex));
      },
    });
  }
});
~~~
:::

:::callout note "Reordering within a lane vs. moving between lanes"
`dropList` reorders *one* container. Moving a card to a **different** lane is a separate action — here, the ‹ ›
arrows, which splice the ticket out of one lane's array and push it onto the next:

```ts
const moveLane = (t: Ticket, lane: LaneId, dir: number) => {
  const target = LANES[LANES.indexOf(lane) + dir];
  if (!target) return;
  lanes[lane].set(lanes[lane]().filter((x) => x.id !== t.id));
  lanes[target].set([...lanes[target](), t]);
};
```
:::

## A lane's markup

Each lane is a header (title + a count `Badge`) and a body — the `dropList` container — of cards. The three lanes
are identical bar their title and lane id; here's one:

:::tabs
~~~html title="app.html (one lane)"
<section class="kanban__col">
  <header class="kanban__col-head">
    <span class="kanban__col-title">To do</span>
    <Badge variant={{ 'tag' }}>{{ todo().length }}</Badge>
  </header>

  <div class="kanban__body" ref={{ todoBody }}>
    @for (c of todo(); track c.id) {
      <div class="kanban__card-wrap">
        <Card class="kanban__card">
          <div class="kanban__card-top">
            <span class="kanban__grip" aria-hidden="true">⠿</span>
            <span class={{ prioClass(c) }}>{{ prioLabel(c) }}</span>
          </div>
          <p class="kanban__card-title">{{ c.title }}</p>
          <div class="kanban__tags">
            @for (tag of c.tags; track tag) {
              <Badge variant={{ 'tag' }}>{{ tag }}</Badge>
            }
          </div>
          <div class="kanban__card-actions">
            <Button variant={{ 'icon' }} label={{ 'Move to previous lane' }}
                    disabled={{ !canLeft('todo') }} on:click={{ () => moveLane(c, 'todo', -1) }}>
              <Icon name={{ 'chevron-left' }} />
            </Button>
            <Button variant={{ 'icon' }} label={{ 'Move to next lane' }}
                    disabled={{ !canRight('todo') }} on:click={{ () => moveLane(c, 'todo', 1) }}>
              <Icon name={{ 'chevron-right' }} />
            </Button>
          </div>
        </Card>
      </div>
    }
  </div>
</section>
~~~
:::

## Notes

- **The grip is why the buttons still work.** Without `handle`, a pointer-down anywhere on a card would start a
  drag — including on the arrow buttons. Scoping the drag to `.kanban__grip` keeps the two gestures separate.
- **Keyed rows survive the reorder.** `track c.id` lets Weave move the existing card element on a drop rather than
  rebuilding it, so the drag feels continuous and nothing inside a card resets.
- **`dropList` is keyboard-accessible too.** It ships Space-to-lift → arrows → Space-to-drop out of the box; give
  your cards a `tabindex` to switch it on for keyboard users.
- **Cross-lane drag is a deliberate omission.** The CDK's `dropList` reorders a single container; dragging between
  lanes (connected lists) isn't wired here, so lane-moves use the arrow buttons instead.

That's the tour. Head back to [the overview](/examples) for the full list, or jump into the
[component reference](/ui/button) to go deeper on any piece.
