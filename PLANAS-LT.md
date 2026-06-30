# Weave → v1: kompiliuojamas, TypeScript framework su signalais

> Tai lietuviška plano versija (tau). Oficiali angliška versija — `C:\Users\ajosas\.claude\plans\soft-splashing-zebra.md`. Jei planas keisis, atnaujinsiu abi.

## Kodėl tai darom (kontekstas)

`framework-analize.docx` analizuoja 5 framework'us (React/Next/Angular/Vue/Svelte, State of JS / React / Stack Overflow 2024–2026). Išvada nuosekli: **visi konverguoja į signals**, visi **myli branduolį, nekenčia naujausio sluoksnio** (React `useEffect`/RSC, Angular RxJS/verbosity, Next.js magija/lock-in). Labiausiai vertinama — Svelte mažytis **kompiliuotas** runtime, Vue/Svelte SFC + scoped CSS, ir TS-first.

v0.1 (jau pastatyta `src/`, 27 testai žali, sukasi naršyklėj) įrodė **reaktyvumo branduolį** ir **runtime** `html\`\`` rendererį. Dabar darom tikrą versiją — kuri daro **ne mažiau nei visi penki, o daugiau: mažesnė, greitesnė, saugesnė, lengvesnė**.

Trys tavo reikalavimai, formavę planą:
1. **Minimum trečios šalies / vulnerabilities** → nulis runtime priklausomybių (jau taip); minimalūs, audituoti dev įrankiai.
2. **Rašom TypeScript, kompiliuojam į JS** → *raktinis* sprendimas: kompiliavimas leidžia generuoti Svelte-klasės fine-grained DOM kodą (mažesnį/greitesnį nei runtime renderer) ir duoda tikrą tipų saugumą.
3. **Pirma planas, po to vykdom** → šis dokumentas; kiekvienas etapas atskirai pristatomas ir testuojamas naršyklėje.

## Užfiksuoti sprendimai (tavo pasirinkti)

- **Rašymo modelis:** **Default — atskiri failai** (Angular stiliaus, kaip vartotojas nori): komponentas = `name.ts` + `name.html` + `name.css`/`name.scss`, susieti per `defineComponent({ template: './name.html', styles: './name.scss', setup() { … return bindings } })`. Vienas `import Counter from './counter'` pasiima viską. **SFC `.weave` (viskas viename) taip pat palaikomas** kaip opcija. Abu mažos rizikos: kompiliatorius kiekvieną komponentą suveda į tą pačią vidinę trijulę `(scriptas, šablonas, stiliai)`; skiriasi tik „loaderis" priekyje — abu maitina vieną konvejerį. (TSX atmestas; tipų saugumas per Volar virtualų `.ts`, atskiriems failams tikrina `.html` išraiškas prieš `ReturnType<typeof setup>`.)
- **Stiliai:** ir `.css` (modernus **native CSS nesting**, nulis priklausomybių — atitinka vulnerabilities taisyklę), ir `.scss` (per `sass` dev-priklausomybę, kraunamą tik kai sutinkamas `.scss`; į produktą nepatenka). Scoping (atributo hash) abiem.
- **Build pagrindas:** **esbuild** (vienas mažų-priklausomybių binaras) TS→JS ir bundlinimui + **mūsų pačių** template kompiliatorius (jokių trečios šalies parser bibliotekų). Oficialus `typescript` tik dev metu, tipų tikrinimui. **Nulis runtime priklausomybių išlieka.**
- **Tvarka:** klientas pirma — ištobulinam reaktyvumą + kompiliatorių + router + store + formas, *po to* SSR.
- **Testai:** headless naršyklė (Playwright), `jsdom` išmetam.

## Ko siekiam / ko NEdarom (šiame etape)

**Siekiam:** tik signals reaktyvumas (jokio VDOM); kompiliuoti fine-grained DOM atnaujinimai; `.weave` SFC su scoped CSS; įmontuotas router + store + formos; TS-first su šablonų tipų tikrinimu; runtime ~3.6 kb gzip klasėje; kompiliuoto komponento dydis ≤ Svelte tam pačiam komponentui.

**NEdarom (dabar):** SSR/hidratacija (paliekam „siūles", statom vėliau), editoriaus LSP poliravimas virš bazinio Volar, mobile/native, `{#await}` blokas.

## Architektūra (kaip viskas veikia)

### Kompiliatoriaus konvejeris (kiekvienam `.weave` failui)
`SFC išskaidymas → šablono parse → script analizė (statinis ar reaktyvus) → pažymim „skyles" → nuleidžiam į plokščią opcode IR → generuojam ESM JS (importai iš @weave/runtime) → esbuild transpiliuoja TS scriptą + sugeneruotą kodą kartu`. Lygiagrečiai: scoped CSS ir virtualaus `.ts` generavimas.

Esmė: **statinė struktūra „užkepama" į vieną klonuojamą `<template>` eilutę**, o dinaminiai mazgai pasiekiami kompiliavimo-metu apskaičiuotais keliais — **jokio runtime medžio apėjimo, jokio `typeof value==='function'` patikrinimo**.

Pavyzdys — `<button on:click={{inc}}>clicks: {{ count() }}</button>` →
```js
import { signal } from '@weave/runtime';
import { template, clone, child, listen, bindText } from '@weave/runtime/dom';
const _tpl = template(`<button>clicks: <!></button>`);   // sukuriama vieną kartą
export default function Counter() {
  const count = signal(0); const inc = () => count.set(n => n + 1);
  const _root = clone(_tpl);
  listen(_root, 'click', inc);              // statinis handleris → JOKIO effect
  bindText(child(_root, 1), () => count()); // reaktyvus → vienas effect, vienas text node
  return _root;
}
```
Statinis `{2+2}` → `setText(node,'4')`, be jokio effect. Reaktyvumo klasifikacija: išraiška reaktyvi tik jei (per kitus kintamuosius) skaito `signal`/`computed`/prop-getterį.

### Šablono kalba (Angular stiliaus blokai — dokumentas sako Angular `@if`/`@for` „sutikti gerai"; vartotojas Angular dev)
- **Interpoliacija:** `{{ expr }}` (Angular). Signalai visada kviečiami su `()`: `{{ count() }}` (jokios auto-call magijos — kaip Angular signals).
- **Neapdorotas HTML:** `{@html expr}` (XSS atsakomybė tavo).
- **Binding'ai naudoja tikrą JS `{{ }}` viduje (M10 — dvigubi skliaustai VISUR, kaip ir teksto interpoliacija)** — lieka tikras TypeScript, esbuild transpiliuoja ir `tsc` tikrina tiesiogiai (sąmoningai NE Angular `"expr()"` kabučių sublankalba, kuri priverstų statyti sunkiausią Angular dalį — išraiškų parserį + language service): atributas `id={{x}}` (boolean dingsta kai falsy), DOM property `.value={{x}}`, event `on:click={{fn}}` (+ modifikatoriai `on:click|preventDefault`), dvipusis `bind:value={{sig}}` (input/checkbox/radio/select/number, IME-saugu), klasė `class:done={{cond}}`, ref `ref={{el}}` / `bind:this`. **Vienas skliaustas `attr={x}` ATMETAMAS** (parseris meta klaidą) — viena sintaksė, fail-loud (M10 step 5). Priežastis dvigubiems: vienas `{` dažnas kaip literalas tekste/markup'e → dviprasmiškas; `{{ }}` retas → mažiau klaidų.
- **Kontrolės srautas (Angular blokai):**
  - `@if (cond) { } @else if (cond) { } @else { }`, su rezultato aliasing `@if (expr; as alias) { … alias … }`.
  - `@for (item of items; track item.id) { } @empty { }`, su implicit `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`.
  - `@switch (x) { @case ('a') { } @default { } }`.
  - `@let name = expr;` — šablono lokalus kintamasis.
- **Komponentai ir slotai:** `<PascalCase prop={{x}} on:event={{h}}>vaikai</…>`; `<slot/>` default/named/scoped. Props per getterius (tingūs, chirurgiški); reaktyvaus prop destrukturizacija = kompiliavimo klaida.

### Runtime kontraktas (`@weave/runtime/dom`, mažytis)
`template/clone/child/anchor/insert` · `setText/bindText · setAttr/bindAttr/bindProp · listen · setRef · bindValue` · `ifBlock/eachBlock/reconcileKeyed/slot` · `root/mountComponent`. Dauguma — v0.1 `dom.js` logikos ištraukos.

**Tikrai naujo kodo:**
- **`reconcileKeyed`** — LIS algoritmu pagrįsti DOM perkėlimai. (Plan agentas pastebėjo: v0.1 `each()` realiai **perstatinėja visą sąrašą iš naujo**, ne perkelia mazgus. Tai didžiausias korektiškumo patobulinimas.)
- **„Owner stack"** — įdėtų (nested) effectų sunaikinimas išmontuojant (apsauga nuo atminties nutekėjimo).
- **`bindValue`** — dvipusiam ryšiui.

Visi kviečia **nepakeistą** reaktyvumo branduolį. Negalim statiškai išgaudyti priklausomybių — pasitikim automatiniu sekimu.

### Scoped CSS
Kompiliavimo-metu atributų hash'inimas (Svelte įrodyta, SSR-saugu, nulis runtime kainos): hash → `[w-xxxxx]`, scope'inam dešiniausią selektorių, atributą „užkepam" į template. Palaikom `:global(...)` ir `@keyframes` vardus. Mažytis savas CSS tokenizeris — jokio PostCSS.

### Šablonų tipų saugumas (Volar-stiliaus virtualus `.ts`)
Kiekvienam `.weave` generuojam niekada-nebundlinimą `Foo.weave.ts`: pažodinis script + sintetinta `__render__()`, kur kiekviena šablono išraiška tipų-tikrinamoje pozicijoje. Source-map'inta atgal į `.weave`. `weave check` paleidžia `tsc --noEmit`; `@weave/volar` plugin'as duos editoriaus raudonas linijas (vėlesnis etapas).

## Paketų struktūra (npm workspaces)
```
packages/
  runtime/   @weave/runtime   reaktyvumo branduolys (TS) + dom helperiai. NULIS deps.
  compiler/  @weave/compiler  SFC split, parser, analizė, codegen, css scoper, esbuild plugin.
  check/     @weave/check     virtualaus .ts + tsc.
  router/    @weave/router    perkeltas router.js (TS).
  store/     @weave/store     perkeltas store.js (TS).
  forms/     @weave/forms     bind:value + signalų validacija.
  cli/       @weave/cli        weave dev / build / check.
  volar/     @weave/volar     editoriaus plugin (neprivaloma, vėlai).
examples/    demo            test/ Playwright testai
```

## Etapai (klientas pirma; kiekvienas testuojamas naršyklėj)
1. **M0** — perkelti branduolį į TS (`@weave/runtime`); 12 testų per Playwright.
2. **M1** — runtime DOM helperiai; chirurgiški text/attr/prop/event/ref atnaujinimai.
3. **M2** — `reconcileKeyed`; išsaugo DOM tapatybę/fokusą/scroll.
4. **M3** — šablono parser + codegen (elementai/interpoliacija/atributai/eventai); `Counter.weave` atitinka M1.
5. **M4** — `{#if}`/`{#each}` + owner/cleanup; nutekėjimo testai.
6. **M5** — komponentai, props-getteriai, slotai.
7. **M6** — scoped CSS.
8. **M7** — esbuild plugin + `weave dev`/`build` (watch + live-reload).
9. **M8** — virtualus `.ts` + `weave check`.
10. **M9** — `@weave/volar` editoriaus plugin.
11. **M10** — router/store perkėlimas + formos su `bind:value`.
12. **M11** — bundle dydžio + našumo riba: runtime ≤ v0.1; komponentas ≤ Svelte.

**SSR — po M11.** „Siūlės" suprojektuotos jau dabar.

## Pagrindinės rizikos (ir apsauga)
- **Keyed reconciliation:** dubliuoti raktai → įspėjimas + index fallback; kiekviena eilutė savo scope; fokuso testai M2.
- **Effect nutekėjimai:** owner stack naikina vaikus prieš tėvus; testai M4.
- **Props reaktyvumas:** props per `.member` (getteriai); destrukturizacija = klaida.
- **`bind:value`:** viskas `bindValue` (number/checkbox/radio/select/IME).
- **Sourcemaps `.weave`→TS→JS:** sujungiam map'us; klaidos rodo originalią eilutę.
- **Neperoptimizuoti reaktyvumo:** niekada statiškai neišgaudyti priklausomybių.

## Patikrinimas
- Kiekvienas etapas: Playwright headless Chromium; tikrinam **chirurginį** DOM keitimą, keyed tapatybę, jokių nutekėjimų.
- `weave check` (M8): klaidingos išraiškos nepraeina `tsc`.
- M11: matuojam gzip dydį prieš Svelte.
- `examples/` demo statomas kiekviename etape.

## Pirmas žingsnis (dabar)
M0: workspace + `@weave/runtime` (`reactive.js` → TS, elgsena nepakeista) + Playwright + 12 testų. Mažos rizikos, atrakina viską kitą.
