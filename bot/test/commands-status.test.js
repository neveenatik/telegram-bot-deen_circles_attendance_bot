import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/status.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

test('status: non-admin is rejected with adminOnly', async () => {
  const { status } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx();

  await status(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('status: admin with no active session gets the no-session summary', async () => {
  const storage = makeStorage({
    getActiveSession: async () => null,
    getMaster: async () => ({ members: [{ name: 'أ', userId: '1' }] }),
  });
  const { status } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true });

  await status(ctx);

  assert.equal(calls.reply[0][0], TEXT.statusNoSession('123', 1));
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('status: admin with an active session sends a status report', async () => {
  const session = {
    name: 'الحلقة',
    participants: { 'أ': { name: 'أ', status: 'present' } },
  };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [{ name: 'أ', userId: '1' }] }),
  });
  const { status } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true });

  await status(ctx);

  assert.equal(calls.replyWithMarkdown.length, 1);
});
