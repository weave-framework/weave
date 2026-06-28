# Weave — feature paritetas su 5 framework'ais (backlog)

> Vidinis darbo dokumentas (kaip `PLANAS-LT.md`). Lygina Weave dabartines galimybes su
> Angular / React / Vue / Svelte / Next.js dokumentacijų feature sąrašais ir klasifikuoja:
>
> - ✅ **yra** — Weave jau turi (gali skirtis autorystės modelis).
> - 🔧 **nėra, verta** — neturim, bet verta įdiegti.
> - ❌ **nėra, neverta** — neturim ir nediegsim (kitokia filosofija arba per smulku / niša).
> - ➖ **dengiama netiesiogiai** — formaliai nėra, bet kitas mechanizmas atstoja.
>
> Publikuojant (žr. atminties `weave-publish-plan`) šis doc bus arba perrašytas, arba neįtrauktas.

## Weave dabartinė bazė (atskaitos taškas)
- **Reaktyvumas:** `signal` · `computed` · `effect` · `batch` · `untrack` · `onCleanup` · owner API
  (`createOwner/runInOwner/disposeOwner/onDispose/getOwner/root`).
- **Šablonai (kompiliuoti, fine-grained):** `{{ }}`, `on:` (+ modifikatoriai), `bind:value` (dvipusis),
  `class:`, `ref`/`bind:this`, tikros JS išraiškos `{ }`. Control flow `@if/@else/@for/@empty/@switch/@let`.
  Slots: default/named/scoped. Scoped CSS (atributo hash).
- **Komponentai:** `defineComponent` (atskiri failai arba `.weave` SFC), props kaip getteriai,
  `on:event`→`onEvent`, `mountComponent`.
- **Įrankiai:** esbuild plugin, `weave build`/`dev` (watch + live-reload), `weave check` (šablonų tipų
  tikrinimas), `pnpm run size` (dydžio biudžetas).
- **Paketai:** `@weave/store` · `@weave/router` (bazinis) · `@weave/forms` (signal-based) ·
  `@weave/data` (`resource` + `createClient`/`HttpError`).
- **Nėra:** SSR/hidratacija · context (provide/inject) · `onMount` · `@defer`/lazy · error boundary ·
  async/Suspense blokas · portal/teleport · transitions/animacijos · `use:` actions · interceptoriai ·
  router guards/lazy/query · i18n · devtools · custom-elements output.

---

## 1. Angular

### Signals
- ✅ Signals · ✅ Async reactivity (resources) · ✅ Side effects for non-reactive APIs (`effect`).
- 🔧 **linkedSignal** (dependent state) — writable signalas, persikraunantis pagal šaltinį. Mažas, vertas.
- 🔧 **Debounced signals** — debounce/throttle utility signalui. Pigus, vertas.

### Components
- ✅ Anatomy · Styling (scoped CSS) · Input properties · Outputs (`on:`→`on…`) · Content projection (slots)
  · Using DOM APIs (`ref`) · Programmatically rendering (`mountComponent`).
- 🔧 **Lifecycle** — yra `setup`+`onDispose`, **trūksta `onMount`** (po DOM įterpimo). Vertas (mažas).
- 🔧 **Host elements** — `:host` scoped CSS / host bindings. Vertas-lite (`:host`).
- 🔧 **Custom Elements** — kompiliuoti į web components (interop). Vertas, bet vėliau (ne core).
- 🔧 **Queries (`@ViewChild`/children)** — `ref` dengia DOM; komponentų užklausos žemo prioriteto.
- ❌ Selectors (globalus registras) · Inheritance · Advanced config — Angular-specifika / kompozicija geriau.

### Templates
- ✅ Text/prop/attr binding · Event listeners · Two-way · Control flow · ng-content→slots · Variables ·
  Expression syntax.
- 🔧 **@defer (deferred loading)** — lazy-load chunk kai matomas/idle. Vertas (dera su kompiliuotu modeliu).
- ❌ Pipes (→ JS funkcijos) · ng-template fragments (→ slots/komponentai) · ng-container (→ blokinis flow +
  fragment multi-root) · Whitespace (jau trimminam).

### Directives
- 🔧 **Attribute directives** — kaip **Svelte-stiliaus `use:action`**. Galingas, mažas. Vertas.
- ❌ Structural directives (→ control flow) · Directive composition API · NgOptimizedImage (niša).

### Dependency Injection
- 🔧 **Injection context → mums provide/inject (tree context)** — be prop-drilling; v0.1 turėjo
  `createContext`, v0.2 nėra. Vertas (lengva versija, NE Angular DI).
- ➖ Services (→ `store()` + ES moduliai).
- ❌ Providers · Hierarchical injectors · Tokens · Lazy services · DI debugging — `import()` + store pakanka.

### Routing (turim bazę)
- ✅ Define routes · Outlets (`RouterView`) · Navigate (`navigate`/`Link`) · Read params.
- 🔧 **Guards** (auth) · **Redirects** · **Lazy routes** · **Query/search param parsinimas** — visi verti.
- ➖ Resolvers (→ `resource` komponente).
- ❌ Custom matchers · Rendering strategies (SSR — atidėta) · Transition animations (optional) ·
  Lifecycle/events (optional) · Reference.

### Forms (turim signal-based bazę)
- ✅ Field state · Validation · Form submission (`valid/values/touchAll`).
- 🔧 **Cross-field logic** (pvz. password confirm) · **Async validacija** (turim `resource`/abort) — verti.
- ➖ Custom controls (`bind:value` su bet kuo, kas atskleidžia signalą).
- ❌ Schemas · Field metadata (optional, zero-dep linija) · Reactive Forms / Strictly typed / Template-driven
  (mūsų signal-forms pakeičia).

### HTTP Client
- ✅ Setup / Making requests (`createClient`) · httpResource (`resource`+client) · Testing (injektuojamas fetch).
- 🔧 **Interceptors** (request/response hook'ai) — turim `onError`+header-funkciją; pilna grandinė verta-lite.

### Testing
- ✅ Basics/component/service (Playwright headless, jokio jsdom).
- ❌ TestBed · Component harnesses · Karma/Jasmine/Vitest migracija · Zone.js utilities — Weave **zoneless**.

### Internationalization
- 🔧/❌ **Visa i18n sekcija** — nėra; dabar neverta core (`Intl` + userland dengia formatavimą; pilna
  extraction/translation pipeline = didelis darbas). Atidėti toli.

---

## 2. React (19)

### Core + Hooks
- ✅ Komponentai (kompiliuoti šablonai vietoj JSX) · `useState`→`signal` · `useEffect`→`effect` ·
  `useMemo`/`useCallback`→`computed` (auto, be deps — geriau) · `useRef`→`ref`/`signal` ·
  Custom hooks→composables (funkcijos, grąžinančios signalus) · Fragments (multi-root) · Events (native, geriau).
- 🔧 **`useContext` (Context/Provider)** — provide/inject. Vertas (žr. Angular DI).
- 🔧 **`useOptimistic`** — optimistinis UI. Iš dalies turim `resource.mutate`; verta-lite.
- 🔧 **`useId`** — stabilūs ID (SSR). Optional/lite.
- ➖ `useReducer` (→ store/signal) · `useSyncExternalStore` (signalai PAČIA yra external store).
- ❌ `useTransition`/`useDeferredValue`/Concurrent mode · `startTransition` — React rendering-concurrency;
  fine-grained modeliui nereikia. · `React.memo`/`PureComponent` (fine-grained = nėra ko memoizuoti) ·
  `StrictMode` (dev double-invoke) · `useImperativeHandle` (niša).

### Suspense / async / klaidos
- 🔧 **Error boundaries** — pagauti render klaidas + fallback UI. Vertas.
- 🔧 **Suspense (async ribos)** — loading fallback šablone. `resource` duoda `loading`; deklaratyvus
  `<Suspense>`-tipo blokas verta-lite.
- 🔧 **`use()` (skaityti promise/context render'e)** — promise dalį dengia `resource` ➖; context dalis = verta.
- 🔧 **`React.lazy` / code splitting** — = `@defer`/lazy routes. Vertas.

### Refs / portals
- ✅ Refs (`ref`). · 🔧 **Portals (`createPortal`)** — modalai/tooltipai kitur DOM. Vertas-lite.
- ➖ `forwardRef` (mūsų props/refs modelis kitoks).

### Server / build
- ❌/atidėta **Server Components · Server Actions · Streaming SSR** — su SSR (atidėta).
- 🔧 **Actions / `useActionState` / `useFormStatus`** — formų submit būsena. Verta-lite (forms backlog).
- ❌ Profiler/devtools (optional).

---

## 3. Vue (3.5)

### Reaktyvumas + SFC
- ✅ `ref`/`computed`/`watchEffect`→`signal`/`computed`/`effect` · SFC (`.weave`+atskiri failai) ·
  Composition API (`setup`) · `defineProps`/`defineEmits`→props/events · `defineModel`→`bind:value`.
- 🔧 **`watch` (su sena/nauja reikšme + explicit šaltiniu)** — `effect` dengia; helper su old/new verta-lite.

### Šablonai / direktyvos
- ✅ `v-if`/`v-for`→`@if`/`@for` · `v-bind`/`v-on`/`v-model` · Slots (named/scoped).
- 🔧 **`v-show`** (toggle `display` vs pašalinti) — turim `@if`=pašalina; `v-show`=paslepia. Verta-lite.
- 🔧 **Custom directives (`v-*`)** — = `use:` actions. Vertas.
- 🔧 **Teleport** — = portal. Vertas-lite.
- 🔧 **Async components / `defineAsyncComponent`** — = lazy/`@defer`. Vertas.
- 🔧 **`<Transition>`/`<TransitionGroup>`** — animacijos. Verta-lite/optional.
- ❌ **Suspense** (Vue eksperimentinis) — optional. · **KeepAlive** (cache state perjungiant) — optional/neverta core.

### Komponentai / state / DI
- ✅ Lifecycle dalis (`onDispose`); 🔧 **`onMounted`→`onMount`** vertas.
- 🔧 **`provide`/`inject`** — Vertas (tree context).
- ✅ Pinia (→ `store`) · Vue Router (→ `router`; guards/lazy verti).
- ❌ Plugins (`app.use`) · Global properties/filters — DI-ish, neverta.

---

## 4. Svelte (5, runes)

### Runes + komponentai
- ✅ `$state`/`$derived`/`$effect`→`signal`/`computed`/`effect` · `$props`→props ·
  `$bindable`/`bind:`→`bind:value` · Komponentai/SFC · Scoped CSS · `bind:this`→`ref` · Event modifiers.

### Blokai / šablonai
- ✅ `{#if}`/`{#each}`→`@if`/`@for`.
- 🔧 **`{#await}` (promise blokas)** — = async/Suspense blokas. `resource` dengia duomenis; šablono await verta-lite.
- 🔧 **`{#key}`** (priverstinai perkurti pasikeitus raktui) — verta-lite/optional.
- 🔧 **Snippets (`{#snippet}`/`{@render}`)** — pakartojami šablono fragmentai su parametrais; turim slots,
  snippet-su-parametrais verta-lite.

### Actions / lifecycle / context / klaidos
- 🔧 **Actions (`use:`)** — Vertas (= attribute directives).
- 🔧 **`onMount`** (yra `onDestroy`→`onDispose`) — Vertas. · `tick()` (laukti DOM atnaujinimo) — verta-lite/optional.
- 🔧 **`setContext`/`getContext`** — = provide/inject. Vertas.
- 🔧 **`<svelte:boundary>`** (error boundary, naujas Svelte 5) — Vertas.
- 🔧 **Transitions/animations** (`transition:`/`animate:`/`in:`/`out:`) — optional.

### Special elements
- 🔧 `<svelte:window>`/`<svelte:body>` (globalūs listeneriai) — galima per `use:`/helperį. Optional.
- 🔧 `<svelte:head>` (title/meta — SEO) — verta-lite, bet siejas su SSR. Optional dabar.
- 🔧 `<svelte:element this={tag}>` (dinaminis tag'as) — verta-lite/optional.
- ✅ Stores (→ `store` + signalai). · ❌ `$inspect`/devtools (optional).

---

## 5. Next.js (15) — meta-framework

> Beveik viskas čia = SSR / routing / build / deploy. Dauguma **atidėta su SSR** (jau žinomas etapas) arba
> jau dengiama mūsų `build`/`dev`/`router`/`data`.

- ✅ Bundling/dev (esbuild `build`/`dev`) · Link/navigation (`Link`) · Client data fetching (`resource`).
- 🔧 **File-based routing** — DX laimėjimas; meta-framework klausimas. Verta-vėliau.
- 🔧 **Nested routes / layouts** — router backlog. Verta-lite.
- 🔧 **Metadata API (SEO `<head>`)** — siejas su SSR. Atidėta.
- 🔧 **Link prefetch** — optional/lite.
- ❌/atidėta **Server Components · Server Actions · SSR/SSG/ISR/streaming · Middleware · serverio caching** — su SSR.
- ❌ **Image/Font/Script optimization** (= NgOptimizedImage) — niša, userland vėliau. · Parallel/intercepting
  routes (niša) · Deployment/config (app reikalas) · Turbopack (turim esbuild).

---

## 6. Suvestinis backlog (dedubliuota, prioriteto tvarka)

Skliausteliuose — kuriuose framework'uose ta feature pasikartoja (kuo daugiau, tuo stipresnis signalas).

### Tier 1 — daugkartinis poreikis, mažas/vidutinis darbas
1. ✅ **provide/inject (tree context)** — (Angular DI · React Context · Vue provide/inject · Svelte context).
   **PADARYTA** (`createContext` token + owner-medis; `@weave/runtime`). *Pašalino prop-drilling.*
2. ✅ **`onMount` lifecycle hook** — (Angular · Vue `onMounted` · Svelte `onMount`).
   **PADARYTA** (microtask po įterpimo, owner-scoped; `@weave/runtime`).
3. **Router: guards + redirects + query params + nested routes** — (Angular · Vue Router · Next). Reali app būtinybė.
4. **`@defer` + lazy components/routes** — (Angular `@defer` · React `lazy` · Vue async components · Next).
   Našumas / code-splitting.
5. **Error boundary** — (React error boundaries · Svelte `<svelte:boundary>`). Atsparumas.
6. **`use:` actions (attribute directives)** — (Angular attribute directives · Vue custom directives · Svelte actions).
   Galingas, mažas.

### Tier 2 — vertingi, vienas/du framework'ai arba lite versija
7. **Async/Suspense šablono blokas** — (React Suspense · Svelte `{#await}` · Vue Suspense). `resource` jau
   duoda `loading`; čia — deklaratyvus fallback.
8. **Portal / Teleport** — (React `createPortal` · Vue Teleport). Modalai/tooltipai.
9. **Forms: cross-field + async validacija** — (Angular). Natūralus `@weave/forms` tęsinys.
10. **HTTP interceptors (lite)** — (Angular). Request/response hook'ai (auth/logging).
11. **`linkedSignal`** + **debounced signals** + **`watch` helper (old/new)** — (Angular · Vue). Pigūs reaktyvumo priedai.
12. **`:host` scoped CSS** — (Angular host elements · Svelte). Mažas.
13. **Optimistic UI / form action state (lite)** — (React `useOptimistic`/`useActionState`). Turim `resource.mutate`.
14. **Snippets su parametrais** — (Svelte snippets). Lankstesni už dabartinius slots.

### Tier 3 — vėliau / optional / siejas su SSR
15. **Custom Elements output** (interop) · **`v-show`/dinaminis elementas** · **`{#key}`** · **`tick()`** ·
    **View/route transition animations** · **`<svelte:head>`/Metadata (SEO)** · **file-based routing** ·
    **Link prefetch**.

### Sąmoningai NEdarom (filosofija / niša)
- DI konteineris (providers/hierarchical injectors/tokens) · Pipes · ng-template/ng-container ·
  Structural directives · Component inheritance · React concurrent mode/transitions/`memo`/StrictMode/
  synthetic events · Zone.js + Angular/React testing harness'ai (turim Playwright) · KeepAlive ·
  NgOptimizedImage / Next image-font optimization · Reactive/Template-driven Forms · plugins/global filters.

### Iškelta į TOLIMĄ ATEITĮ — SSR (NE v1) ⚠️
Vartotojo sprendimas (2026-06-28): SSR visiškai už v1 ribų — reta praktikoje, mažai kas naudoja. Jei kada kam
prireiks, plane paliktos „siūlės" (kompiliatoriaus `mode:'ssr'` + hidratacija per fine-grained binding'us).
- Server Components/Actions · SSR/SSG/ISR/streaming · hidratacija · serverio caching · middleware ·
  metadata/SEO `<head>` · rendering strategies.

---

## 7. Kelias iki v1 (sutarta 2026-06-28)

Sprendimai: **SSR iškelta už v1** · **B/C fazės — darom pilnai** („jei darom tai darom"; Tier 2 + ne-SSR
Tier 3 polišas įeina, padaryta kaip reikia).

- **A faza — Core paritetas (Tier 1):** ✅ provide/inject · ✅ `onMount` · Router++ (guards/redirects/query/nested)
  · `@defer`+lazy · error boundary · `use:` actions.
- **B faza — Polish (pilnas Tier 2 + ne-SSR Tier 3):** async/Suspense blokas · portal/teleport · forms
  cross-field+async · HTTP interceptors · `linkedSignal`/debounced/`watch` · `:host` CSS · optimistic UI ·
  snippets su parametrais · custom elements · `v-show`/dinaminis elementas · `{#key}` · `tick()` · transitions
  · file-based routing · Link prefetch. (SEO/`<svelte:head>` — krenta kartu su SSR.)
- **C faza — Įrankiai/DX:** M9 Volar (editoriaus plugin) · child-prop tipų tikrinimas `weave check`'e ·
  perf benchmark (M11 antra dalis).
- **D faza — Demo app:** reali app (router+store+forms+data) — integracija + showcase.
- **F faza — Dokumentacija:** perrašyti viską public-ready forma (be AI pėdsakų).
- **G faza — Publikavimas:** scrub tooling · public repo + pirmas mirror · sync workflow
  (žr. atminties `weave-publish-plan`).

Pradžia: **A faza → `provide/inject`** (mažas, atrakina context-priklausomus features).
