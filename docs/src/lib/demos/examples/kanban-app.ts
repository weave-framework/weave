import { signal, onMount, type Signal } from '@weave-framework/runtime';
import { dropList, moveItemInArray } from '@weave-framework/ui/cdk';
import Card from '@weave-framework/ui/card';
import Badge from '@weave-framework/ui/badge';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Card;
void Badge;
void Button;
void Icon;

type LaneId = 'todo' | 'doing' | 'done';
type Priority = 'low' | 'med' | 'high';
interface Ticket {
  id: number;
  title: string;
  priority: Priority;
  tags: string[];
}

const LANES: LaneId[] = ['todo', 'doing', 'done'];
const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', med: 'Medium', high: 'High' };

interface Setup {
  todo: () => Ticket[];
  doing: () => Ticket[];
  done: () => Ticket[];
  todoBody: Signal<HTMLElement | null>;
  doingBody: Signal<HTMLElement | null>;
  doneBody: Signal<HTMLElement | null>;
  prioClass: (t: Ticket) => string;
  prioLabel: (t: Ticket) => string;
  canLeft: (lane: LaneId) => boolean;
  canRight: (lane: LaneId) => boolean;
  moveLane: (t: Ticket, lane: LaneId, dir: number) => void;
}

/** A kanban board: drag to reorder within a lane, arrows to move between lanes. */
export function setup(): Setup {
  const lanes: Record<LaneId, Signal<Ticket[]>> = {
    todo: signal<Ticket[]>([
      { id: 1, title: 'Design the empty state', priority: 'med', tags: ['ui'] },
      { id: 2, title: 'Write the onboarding email', priority: 'low', tags: ['growth', 'copy'] },
      { id: 3, title: 'Audit the colour contrast', priority: 'high', tags: ['a11y'] },
    ]),
    doing: signal<Ticket[]>([
      { id: 4, title: 'Build the settings page', priority: 'high', tags: ['feature'] },
      { id: 5, title: 'Fix the flaky upload test', priority: 'med', tags: ['bug', 'ci'] },
    ]),
    done: signal<Ticket[]>([{ id: 6, title: 'Ship the dark theme', priority: 'med', tags: ['ui'] }]),
  };

  const todoBody = signal<HTMLElement | null>(null);
  const doingBody = signal<HTMLElement | null>(null);
  const doneBody = signal<HTMLElement | null>(null);
  const bodies: Record<LaneId, Signal<HTMLElement | null>> = {
    todo: todoBody,
    doing: doingBody,
    done: doneBody,
  };

  // Attach a reorderable drop list to each lane body once it's in the DOM.
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

  const moveLane = (t: Ticket, lane: LaneId, dir: number): void => {
    const targetIdx = LANES.indexOf(lane) + dir;
    if (targetIdx < 0 || targetIdx >= LANES.length) return;
    const target = LANES[targetIdx];
    lanes[lane].set(lanes[lane]().filter((x) => x.id !== t.id));
    lanes[target].set([...lanes[target](), t]);
  };

  return {
    todo: lanes.todo,
    doing: lanes.doing,
    done: lanes.done,
    todoBody,
    doingBody,
    doneBody,
    prioClass: (t) => `kanban__prio kanban__prio--${t.priority}`,
    prioLabel: (t) => PRIORITY_LABEL[t.priority],
    canLeft: (lane) => LANES.indexOf(lane) > 0,
    canRight: (lane) => LANES.indexOf(lane) < LANES.length - 1,
    moveLane,
  };
}
