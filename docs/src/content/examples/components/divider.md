# Divider — examples

Every feature of the `weave-divider` class, each as a live, self-contained example you can read and lift
straight into your project. The prose lives on the [Divider reference page](/ui/divider); this page is just
the examples, covering the full component surface.

A Divider isn't a JavaScript component — it's a **CSS class**, so there's nothing to import in TypeScript.
Pull in the styles once:

```scss
@use 'pkg:@weave-framework/ui/divider';
```

## Horizontal

The default `weave-divider` is a horizontal hairline. Drop it on an empty element between the things you're
separating — here, between stacked list rows.

:::demo ex-divider-horizontal

:::tabs
~~~html title="app.html"
<div style="display:flex; flex-direction:column;">
  <div style="padding:10px 4px;">Inbox</div>
  <div class="weave-divider"></div>
  <div style="padding:10px 4px;">Starred</div>
  <div class="weave-divider"></div>
  <div style="padding:10px 4px;">Sent</div>
</div>
~~~
:::

## Vertical

Add `weave-divider--vertical` for a vertical rule — handy between inline actions. It centres itself in the
row and stands `--weave-divider-height` tall (16px by default), so override that token if you want it taller
or shorter.

:::demo ex-divider-vertical

:::tabs
~~~html title="app.html"
<div style="display:flex; align-items:center; gap:14px; height:32px;">
  <span>Edit</span>
  <div class="weave-divider weave-divider--vertical"></div>
  <span>Duplicate</span>
  <div class="weave-divider weave-divider--vertical"></div>
  <span>Delete</span>
</div>
~~~
:::

## Semantic separator

A divider is decorative by default, so a plain `<div>` (no role) stays out of the accessibility tree. When
the break is *semantically* meaningful — say, between groups in a menu — put `role="separator"` on the
element so assistive tech announces it.

:::demo ex-divider-semantic

:::tabs
~~~html title="app.html"
<div role="menu">
  <div role="menuitem">Cut</div>
  <div role="menuitem">Copy</div>
  <div role="menuitem">Paste</div>
  <div class="weave-divider" role="separator"></div>
  <div role="menuitem">Select all</div>
</div>
~~~
:::

## Customising

Every value comes from the divider's token schema — `--weave-divider-thickness`, `--weave-divider-line`, and
`--weave-divider-height` (vertical length). Retint or resize a single rule inline, or reskin every divider
globally with `divider-overrides()` in SCSS.

:::demo ex-divider-custom

:::tabs
~~~html title="app.html"
<div
  class="weave-divider"
  style="--weave-divider-thickness:2px; --weave-divider-line:var(--accent);"
></div>

<div
  class="weave-divider weave-divider--vertical"
  style="--weave-divider-thickness:2px; --weave-divider-height:28px; --weave-divider-line:var(--accent);"
></div>
~~~
~~~scss title="global override"
@use 'pkg:@weave-framework/ui' as weave;

@include weave.divider-overrides((thickness: 2px, height: 28px));
~~~
:::
