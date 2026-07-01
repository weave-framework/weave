import { test, assert } from '../../../../tools/harness.js';
import { copy } from '@weave-framework/ui/cdk';

function withClipboard(value: unknown, fn: () => Promise<void>): Promise<void> {
  const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard') ?? Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  return fn().finally(() => {
    if (desc) Object.defineProperty(navigator, 'clipboard', desc);
    else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
}

test('clipboard: uses the async Clipboard API when available', async () => {
  let captured: string | null = null;
  await withClipboard({ writeText: async (t: string) => void (captured = t) }, async () => {
    const ok: boolean = await copy('hello');
    assert.equal(ok, true);
    assert.equal(captured, 'hello');
  });
});

test('clipboard: falls back to execCommand when the API rejects', async () => {
  const originalExec: typeof document.execCommand = document.execCommand;
  let execArg: string | null = null;
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = (c: string) => {
    execArg = c;
    return true;
  };
  try {
    await withClipboard(
      {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      async () => {
        const ok: boolean = await copy('fallback');
        assert.equal(ok, true, 'fell back successfully');
        assert.equal(execArg, 'copy', 'execCommand("copy") used');
      },
    );
  } finally {
    document.execCommand = originalExec;
  }
});

test('clipboard: falls back when there is no Clipboard API', async () => {
  const originalExec: typeof document.execCommand = document.execCommand;
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = () => true;
  try {
    await withClipboard(undefined, async () => {
      const ok: boolean = await copy('no-api');
      assert.equal(ok, true);
    });
  } finally {
    document.execCommand = originalExec;
  }
});

test('clipboard: reports failure when execCommand fails and no API', async () => {
  const originalExec: typeof document.execCommand = document.execCommand;
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = () => false;
  try {
    await withClipboard(undefined, async () => {
      const ok: boolean = await copy('nope');
      assert.equal(ok, false);
    });
  } finally {
    document.execCommand = originalExec;
  }
});
