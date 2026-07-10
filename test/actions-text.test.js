import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('onText: a command message passes through to the next middleware', async () => {
  const { onText } = createHandlers({ storage: makeStorage(), telegram: makeTelegram() });
  const { ctx } = makeCtx({ text: '/status' });
  let nextCalled = false;

  await onText(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('onText: with no pending awaiting entry passes through', async () => {
  const storage = makeStorage({ getAwaiting: async () => null });
  const { onText } = createHandlers({ storage, telegram: makeTelegram() });
  const { ctx } = makeCtx({ text: 'مرحبا' });
  let nextCalled = false;

  await onText(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
