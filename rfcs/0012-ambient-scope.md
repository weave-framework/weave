# RFC 0012: An app with no plumbing — ambient scope, resolved at compile time

- **Status:** Draft — deliberately not started; see "Measured before building"
- **Author(s):** Aidas Josas (@aidasjosas)
- **Discussion:** —

## Summary

A component reads a name it did not declare — `{{ user.name }}` five levels down — and the compiler resolves
where that name comes from by walking the **actual template nesting**, then wires it as a direct reference.
No providers, no context API, no store boilerplate, no props threaded through components that do not use them.

It is **lexical scope that crosses the file boundary**, resolved statically. It is *not* dynamic scope, which
is the historical mistake this is most likely to be confused with.

## Motivation

In every framework, the largest category of code that is not the product is **wiring**: imports, props passed
through components that never read them, "lifting state up", context providers, a store with actions and
selectors, and a `useX()` in every file that needs anything.

Weave already removed one half of this. A child component needs no import — a PascalCase tag resolves to a
module by convention (`resolveChildModule`). The other half, **values**, is still threaded by hand.

## The mechanism

Resolution happens at each **use site**, not once per component:

1. The compiler already builds the component graph (it resolves every child tag to a module).
2. A free identifier in a template that this component's `setup` does not provide is looked up outward through
   the templates that lexically contain the component.
3. Where it resolves, the compiler **synthesizes a prop** on the child and passes it at that use site. The
   emitted code is an ordinary prop pass — a direct reference, not a runtime lookup.

**Cost: zero at runtime.** It is faster than context, which walks a tree while the app is running. Nothing is
looked up, retried or cached; the reference is compiled in.

## Scoping rules

These are the rules that decide whether this is safe. Each exists because of a way the naive version goes wrong.

1. **Nearest lexical wins.** Block bindings first (`@for`, `@let`, `@if (… as x)`), then the component's own
   `setup`, then outward through the real template nesting. Exactly like JavaScript.
2. **Shadowing is reported once.** When a name shadows an outer one, that is legal and it is also the case a
   human misreads, so the compiler says so.
3. **Ambiguity is an error, never a guess.** A name that does not resolve uniquely is a compile error naming
   both candidates.
4. **A component may declare what it expects** — `expects { items: Task[] }`. From that moment it is a
   contract, checked at every use site, and nothing is ambient about it. Ambient resolution is for the
   fragment extracted in place; a declaration is for the component meant to be reused. **Props are not lost;
   the right to not write them is gained.**
5. **No action at a distance.** A component resolves only from templates that **lexically contain** it. Passed
   into a slot from elsewhere, it must declare (rule 4).
6. **The editor answers instantly.** Hover shows `items ← orders.ts:12`. The classic objection to implicit
   scope — "you cannot tell where it came from" — is answered by a compiler that knows exactly, not by a
   convention.
7. **Rename understands resolution.** `withSetupConstRename` already renames a binding and the const behind it;
   renaming an outer name must update every use that resolves to it, or refuse when the rename would silently
   change what resolves to what.

## What this does not do

- It does not make a name reachable that no enclosing template provides.
- It does not cross a slot boundary, a `lazy()` boundary, or a route boundary implicitly.
- It does not replace props. It removes the obligation to write them for the local case.

## Why this is possible here

Resolving a name across a component tree requires knowing that tree **statically**. A framework whose tree is
assembled at runtime cannot. Weave compiles the whole app and already builds the graph — the same one
`weave check --impact` now reads.

## Measured before building — and the measurement says wait

The motivation above is an argument. Before writing any of it, the argument was checked against the code
that exists here (the docs site, the demo, and the UI library, including the inline-template components the
first two attempts at this measurement silently skipped):

```
components with a template   487
  declaring props             37   (287 props)
  props used in a template    47
  props ONLY handed to a child 1
```

**One.** Prop drilling is the thing this RFC removes, and in every app in reach it is not happening: a page
composes UI components directly, so almost nothing is threaded through an intermediate component. The cost
this would pay back is not being paid here.

That is not proof the problem is imaginary — these are shallow apps, and a deep business app is exactly where
threading appears. It IS proof that we cannot judge the design here, and the plan's own rule applies: no
speculative building; a milestone waits for a real pull from a real app.

**So: this RFC stays Draft, and the trigger is explicit.** Re-run the measurement on the next real
dogfooding app. If "props only handed to a child" is still in the single digits, the feature is not worth its
risk. If it is in the dozens, build stage 1 and measure again.

## Staging

There is no safe partial per name: a name either resolves and is wired, or it is an error. But the work stages:

1. **Resolution + diagnostics only.** The compiler resolves and reports (unique / ambiguous / shadowed) without
   emitting anything. Measurable on the docs site before any behaviour changes.
2. **Emission** for the unambiguous case, behind a config flag.
3. **`expects`**, which makes the reusable case explicit.
4. **Editor**: hover origin, and rename that follows resolution.

## Risks

- **Readability at scale.** Mitigated by rule 6 and by rule 4 becoming the convention for anything exported.
- **A rename that changes resolution silently.** Rule 7 must refuse, not guess.
- **Compile cost.** Resolution is a graph walk per use site; it must be cached per build, not per component.

## Versioning

Additive: existing props keep working unchanged, so this is a **MINOR**, and the frozen API promise holds. It
still ships behind a flag until it has been measured on a real app.
