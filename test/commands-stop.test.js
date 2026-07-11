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

test('editlist: admin gets the edit panel in their DM', async () => {
  const session = { type: 'main', active: true, name: 'الحلقة', chatId: '123', participants: {} };
  const telegram = makeTelegram();
  const storage = makeStorage({ getSession: async (_gid, type) => (type === 'main' ? session : null) });
  const { editlist } = createHandlers({ storage, telegram });
  const { ctx, calls } = makeCtx({ admin: true, userId: 777 });

  await editlist(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1, 'panel sent once');
  assert.equal(telegram.calls.sendMessage[0][0], 777, 'panel delivered to the admin DM');
  assert.equal(calls.reply[0][0], TEXT.panelSentToDm, 'group gets an ephemeral confirmation');
});

test('editlist: nudges the admin when the DM is closed', async () => {
  const session = { type: 'main', active: true, name: 'الحلقة', chatId: '123', participants: {} };
  const telegram = makeTelegram({ sendMessage: async () => { throw new Error('Forbidden: bot can\'t initiate conversation with a user'); } });
  const storage = makeStorage({ getSession: async (_gid, type) => (type === 'main' ? session : null) });
  const { editlist } = createHandlers({ storage, telegram });
  const { ctx, calls } = makeCtx({ admin: true });

  await editlist(ctx);

  assert.ok(String(calls.reply[0][0]).includes('الخاص'), 'group gets a start-the-bot nudge');
});

test('freezeList: non-admin is rejected', async () => {
  const { freezeList } = stopHandlers();
  const { ctx, calls } = makeCtx();

  await freezeList(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});
