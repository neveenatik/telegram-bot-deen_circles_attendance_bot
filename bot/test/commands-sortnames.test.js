import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/sortnames.js';
import { TEXT } from '../lib/text.js';
import { makeCtx } from './mocks.js';

test('sortnames: non-admin is rejected', async () => {
  const { sortnames } = createHandlers();
  const { ctx, calls } = makeCtx({ text: '/sortnames أ، ب' });

  await sortnames(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('sortnames: admin with "start" begins collection mode', async () => {
  const { sortnames } = createHandlers();
  const { ctx, calls } = makeCtx({ admin: true, text: '/sortnames start' });

  await sortnames(ctx);

  assert.equal(calls.reply[0][0], TEXT.sortnamesStartCollect);
});

test('sortnames: admin with inline names replies with a sorted list', async () => {
  const { sortnames } = createHandlers();
  const { ctx, calls } = makeCtx({ admin: true, chatId: 555, userId: 42, text: '/sortnames ب، أ' });

  await sortnames(ctx);

  assert.equal(calls.reply.length, 1);
  assert.match(calls.reply[0][0], /أ/);
});
