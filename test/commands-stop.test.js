import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/stop.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

function stopHandlers(overrides = {}) {
  const storage = makeStorage({ getSession: async () => null, ...overrides });
  return createHandlers({ storage, telegram: makeTelegram() });
}

test('stoplist: non-admin is rejected', async () => {
  const { stoplist } = stopHandlers();
  const { ctx, calls } = makeCtx();

  await stoplist(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('stoplist: admin with no active session reports no session', async () => {
  const { stoplist } = stopHandlers({ getSession: async () => null });
  const { ctx, calls } = makeCtx({ admin: true });

  await stoplist(ctx);

  assert.equal(calls.reply[0][0], TEXT.noSessionActive);
});

test('editlist: non-admin is rejected', async () => {
  const { editlist } = stopHandlers();
  const { ctx, calls } = makeCtx();

  await editlist(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('editlist: admin with no active session reports no session', async () => {
  const { editlist } = stopHandlers({ getSession: async () => null });
  const { ctx, calls } = makeCtx({ admin: true });

  await editlist(ctx);

  assert.equal(calls.reply[0][0], TEXT.noSessionActive);
});

test('freezeList: non-admin is rejected', async () => {
  const { freezeList } = stopHandlers();
  const { ctx, calls } = makeCtx();

  await freezeList(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});
