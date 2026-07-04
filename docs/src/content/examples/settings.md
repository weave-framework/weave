# Settings panel

One screen, every kind of input. This example lays out a real preferences form — text, email, a dropdown, a
radio group, a slider, and a few toggles — next to a **live preview** that reflects your changes as you make them.
It's the tour of `@weave-framework/ui`'s form controls, all bound to signals the same way.

:::demo examples-settings

Edit any field and watch the preview on the right update instantly. Switch the preview between **Summary** and
**JSON**. Hit **Save** for a snackbar; **Reset** to restore the defaults.

## What it shows

- **Every form control, one binding pattern** — [`Input`](/ui/input), [`Select`](/ui/select),
  [`RadioGroup`](/ui/radio), [`Slider`](/ui/slider), and [`SlideToggle`](/ui/slide-toggle) each bind a `signal`
  with a `value`/`checked` in and a change handler out. Learn one, you've learned them all.
- **A single derived model** — one `settings` computed gathers the whole form into an object; the preview reads
  only that. [Reactivity →](/learn/reactivity)
- **Arbitrary tab content** — the preview [`Tabs`](/ui/tabs) render live nodes (a definition list, a JSON dump)
  via each tab's `content` factory, kept in sync by an `effect`.
- **Imperative feedback** — [`snackbar()`](/ui/snackbar) is called from the save handler; no component to place.

## The form

The whole form is plain template. Each control is one line, and every one follows the identical shape: a reactive
`value` (or `checked`) reads a signal, and a handler writes it back. Wrapping it in a `<form>` with
`on:submit` means **Enter saves** for free.

:::tabs
~~~html title="app.html"
<form class="settings__form" on:submit={{ save }}>
  <section class="settings__group">
    <h4 class="settings__h">Account</h4>
    <Input value={{ name() }} onInput={{ setName }} label={{ 'Display name' }} />
    <Input type={{ 'email' }} value={{ email() }} onInput={{ setEmail }} label={{ 'Email' }} />
    <Select options={{ languageOpts }} value={{ language() }} onChange={{ setLanguage }} label={{ 'Language' }} />
  </section>

  <section class="settings__group">
    <h4 class="settings__h">Appearance</h4>
    <RadioGroup options={{ themeOpts }} value={{ theme() }} onChange={{ setTheme }} label={{ 'Theme' }} />
    <Slider min={{ 0 }} max={{ 2 }} step={{ 1 }} value={{ density() }} onChange={{ setDensity }}
            format={{ densityFmt }} label={{ 'Density' }} />
    <SlideToggle checked={{ reduceMotion() }} onChange={{ setReduceMotion }} label={{ 'Reduce motion' }} />
  </section>

  <section class="settings__group">
    <h4 class="settings__h">Notifications</h4>
    <SlideToggle checked={{ emailNotif() }} onChange={{ setEmailNotif }} label={{ 'Email notifications' }} />
    <SlideToggle checked={{ pushNotif() }} onChange={{ setPushNotif }} label={{ 'Push notifications' }} />
  </section>

  <div class="settings__actions">
    <Button type={{ 'submit' }}>Save changes</Button>
    <Button type={{ 'button' }} variant={{ 'ghost' }} on:click={{ reset }}>Reset</Button>
  </div>
</form>
~~~
:::

:::callout tip "One pattern, every control"
`Input` uses `value` + `onInput`; `Select` and `RadioGroup` use `value` + `onChange`; `Slider` and `SlideToggle`
use `value`/`checked` + `onChange`. The prop names differ to match each control's nature, but the *shape* is
always the same — a reactive read in, a setter out. There is no `v-model`, no `formControlName`, no two-way magic;
just a signal and a handler you can see.
:::

## The controls in setup

Each control is one signal and a one-line setter. The `densityFmt` function is handed to the slider's `format`
prop so the thumb reads "Cozy" instead of "1".

:::tabs
~~~ts title="app.ts (state)"
import { signal, computed, effect } from '@weave-framework/runtime';
import { snackbar } from '@weave-framework/ui/snackbar';

const DENSITY = ['Compact', 'Cozy', 'Comfortable'];

export function setup() {
  const name = signal('Aidas');
  const email = signal('aidas@example.com');
  const language = signal('en');
  const theme = signal('system');
  const density = signal(1);
  const reduceMotion = signal(false);
  const emailNotif = signal(true);
  const pushNotif = signal(false);

  const densityFmt = (v: number) => DENSITY[v] ?? String(v);

  // One derived object gathering the whole form — the preview reads only this.
  const settings = computed(() => ({
    name: name(), email: email(), language: language(), theme: theme(),
    density: densityFmt(density()), reduceMotion: reduceMotion(),
    emailNotif: emailNotif(), pushNotif: pushNotif(),
  }));

  const save = (e?: Event) => {
    e?.preventDefault();
    snackbar('Settings saved', { action: 'Undo', duration: 3000 });
  };

  return { name, email, language, theme, density, reduceMotion, emailNotif, pushNotif,
    densityFmt, settings, save,
    setName: (v: string) => name.set(v),
    setDensity: (v: number) => density.set(v),
    setReduceMotion: (v: boolean) => reduceMotion.set(v),
    /* …one setter per field… */ };
}
~~~
:::

## The live preview

The preview is two `Tabs` panels. A tab's `content` can be a `Node`, a string, or a **factory** `() => Node`;
here each factory builds a small element and an `effect` keeps it in sync with the `settings` computed. This is
how you drop live, reactive content into a component that expects nodes.

:::tabs
~~~ts title="preview panels (in setup)"
// A tab's content can be a factory returning a node. The effect re-renders it
// whenever `settings()` changes — so the preview tracks the form live.
const jsonPanel = () => {
  const pre = document.createElement('pre');
  pre.className = 'settings__json';
  effect(() => {
    pre.textContent = JSON.stringify(settings(), null, 2);
  });
  return pre;
};

const previewTabs = [
  { label: 'Summary', content: summaryPanel },
  { label: 'JSON', content: jsonPanel },
];
~~~
~~~html title="preview (in app.html)"
<aside class="settings__preview">
  <Card>
    <h4 class="settings__h">Live preview</h4>
    <Tabs tabs={{ previewTabs }} value={{ tab() }} onChange={{ setTab }} label={{ 'Preview format' }} />
  </Card>
</aside>
~~~
:::

## Notes

- **The preview never touches the form.** It reads `settings()` and nothing else. That's the payoff of funnelling
  state through one computed — anything that wants "the current settings" asks in one place.
- **`format` is just a function.** The slider stores a number (`0`–`2`) but shows a word, because `format` maps
  the value to a label. The stored value stays clean; only the display is prettified.
- **Saving is a function call.** `snackbar()` is imperative on purpose — feedback is an action, not a piece of
  layout, so you call it from the handler rather than rendering a component and toggling its visibility.

Next: real validation. The [Sign-up wizard](/examples/signup) walks a multi-step form with per-field rules and a
blocked "Next" button.
