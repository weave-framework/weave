// Presentational component shipped as the <weave-badge> custom element.
// No setup — it renders the `priority` prop directly (auto-inferred as a ctx name).
// Template + styles declared inline (no sibling .html / .scss).

// Opt in as a native custom element: the build discovers this `tag` (+ `props`) and
// auto-registers it in the generated bootstrap — no manual register-elements file.
export const tag: string = 'weave-badge';
export const props: string[] = ['priority'];

export const template: string = `<span class="badge" data-priority={{priority}}>{{ priority }}</span>`;

export const styles: string = `
  .badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 999px;
    color: #0b0d11;
    background: var(--todo);
  }
  .badge[data-priority="med"] { background: var(--doing); }
  .badge[data-priority="high"] { background: #f85149; color: #fff; }
`;
