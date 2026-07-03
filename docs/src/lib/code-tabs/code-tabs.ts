import Tabs from '@weave-framework/ui/tabs';
import CodeBlock from '../code-block/code-block';

export interface CodeTab {
  /** Tab label, e.g. "counter.ts", "HTML", or a language tag. */
  label: string;
  /** Language tag for the code block. */
  lang: string;
  /** Source shown when the tab is active. */
  code: string;
}

interface CodeTabsProps {
  tabs?: CodeTab[];
}

interface WeaveTab {
  label: string;
  content: () => Node;
}

interface CodeTabsSetup {
  /** The tabs shaped for the composed Weave-UI `<Tabs>` — each panel is a `<CodeBlock>`. */
  weaveTabs: () => WeaveTab[];
}

// `<Tabs>` is composed in the template; `<CodeBlock>` builds each panel's body.
void Tabs;
void CodeBlock;

/** Shows one or more source files as the real Weave-UI `<Tabs>` — every code sample on the
 *  site (single snippet or multi-file) is this component, so they're all switchable, copyable
 *  tabs with the language/filename as the tab label (no separate corner label to overlap). */
export function setup(props: CodeTabsProps): CodeTabsSetup {
  const weaveTabs = (): WeaveTab[] =>
    (props.tabs ?? []).map((t) => ({
      label: t.label,
      content: (): Node => CodeBlock({ code: t.code, lang: t.lang }) as Node,
    }));
  return { weaveTabs };
}
