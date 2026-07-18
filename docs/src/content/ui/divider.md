# Divider

A hairline rule that separates content — a group of list items from the next, a row of actions from each other. A
Divider is the lightest thing in the library: it's not a component, just a **CSS class** you drop on an element, so
there's nothing to import in JavaScript.

:::demo divider-basic

## Import

Styles only — there's no JS component:

```scss
@use 'pkg:@weave-framework/ui/divider';
```

## Usage

Put the `weave-divider` class on an empty element between the things you're separating:

```html
<p>Section one</p>
<div class="weave-divider"></div>
<p>Section two</p>
```

## Vertical

Add `weave-divider--vertical` for a vertical rule — handy between inline actions. It's a fixed 16px tall
(`--weave-divider-height`) and centres itself in its row:

```html
<div style="display:flex; align-items:center; gap:14px; height:32px;">
  <span>Edit</span>
  <div class="weave-divider weave-divider--vertical"></div>
  <span>Delete</span>
</div>
```

## Accessibility

A divider is decorative, so a plain `<div>` (no role) is correct — it stays out of the accessibility tree. If a
separator is *semantically* meaningful in your layout (say, between groups in a menu), put the class on an element
with `role="separator"` instead so assistive tech announces the break.

## Customising

Every value comes from the divider's token schema — `line` (the rule's colour), `thickness`, and `height` (the
vertical rule's length) — so you can retint or resize it without touching markup:

```scss
@use 'pkg:@weave-framework/ui' as weave;

@include weave.divider-overrides((thickness: 2px, height: 28px));
```

They land as `--weave-divider-thickness`, `--weave-divider-line`, and `--weave-divider-height`, so you can also
override them inline on a single rule.
