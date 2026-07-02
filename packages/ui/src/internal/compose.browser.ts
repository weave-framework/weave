import { test, assert } from '../../../../tools/harness.js';
import * as dom from '@weave-framework/runtime/dom';
import * as InputMod from '@weave-framework/ui/input';
import * as ButtonMod from '@weave-framework/ui/button';
import { toComponent } from './compose.js';

/* Proof that a component template can COMPOSE an existing Weave component (no re-creation). */

test('compose: a parent template renders the real <Input> component as a child', () => {
  const Wrapper: unknown = toComponent(
    { template: '<div class="wrap"><Input placeholder="Search" /></div>' },
    { Input: toComponent(InputMod as never) }
  );
  const host: HTMLElement = document.createElement('div');
  document.body.appendChild(host);
  const unmount: () => void = dom.mountComponent(Wrapper as never, host);
  assert.ok(host.querySelector('.weave-input'), 'the real Input component rendered');
  assert.ok(host.querySelector('input.weave-input__field'), 'its native field is present');
  assert.equal(host.querySelector('input')?.getAttribute('placeholder'), 'Search', 'the prop flowed in');
  unmount();
  host.remove();
});

test('compose: a parent template renders the real <Button> with slotted content + event', () => {
  let clicked: number = 0;
  const Wrapper: unknown = toComponent(
    { template: '<div><Button on:click={{ hit }}>Save</Button></div>', },
    { Button: toComponent(ButtonMod as never) }
  );
  // the wrapper needs a `hit` handler in its ctx — give it a setup
  const WrapperWithHandler: unknown = toComponent(
    {
      setup: () => ({ hit: (): void => { clicked += 1; } }),
      template: '<div><Button on:click={{ hit }}>Save</Button></div>',
    },
    { Button: toComponent(ButtonMod as never) }
  );
  void Wrapper;
  const host: HTMLElement = document.createElement('div');
  document.body.appendChild(host);
  const unmount: () => void = dom.mountComponent(WrapperWithHandler as never, host);
  const btn: HTMLButtonElement | null = host.querySelector('button.weave-button');
  assert.ok(btn, 'the real Button component rendered');
  assert.equal(btn?.textContent?.trim(), 'Save', 'slotted content projected');
  btn?.click();
  assert.equal(clicked, 1, 'the on:click event flowed to the wrapper handler');
  unmount();
  host.remove();
});
