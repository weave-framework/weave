import { signal } from '@weave-framework/runtime';
import CodeBlock from '../code-block/code-block';

export interface CodeTab {
  /** Tab label, e.g. "counter.ts" or "HTML". */
  label: string;
  /** Language tag for the code block. */
  lang: string;
  /** Source shown when the tab is active. */
  code: string;
}

interface CodeTabsProps {
  tabs?: CodeTab[];
}

interface CodeTabsSetup {
  tabs: () => CodeTab[];
  current: () => CodeTab;
  select: (label: string) => void;
  isActive: (label: string) => boolean;
}

// `<CodeBlock>` is referenced in the template.
void CodeBlock;

/** Shows related sources (e.g. an HTML template + its `.ts`) as switchable,
 *  copyable tabs — the way you'd flip between files in an editor. */
export function setup(props: CodeTabsProps): CodeTabsSetup {
  const tabs = (): CodeTab[] => props.tabs ?? [];
  const active = signal(tabs()[0]?.label ?? '');

  const current = (): CodeTab =>
    tabs().find((t) => t.label === active()) ?? tabs()[0] ?? { label: '', lang: 'ts', code: '' };
  const select = (label: string): void => active.set(label);
  const isActive = (label: string): boolean => active() === label;

  return { tabs, current, select, isActive };
}
