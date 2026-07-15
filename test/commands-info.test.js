import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/info.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

test('start: non-admin is rejected with adminOnly', async () => {
  const { start } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx();

  await start(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('start: admin gets the admin help text', async () => {
  const { start } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ admin: true });

  await start(ctx);

  assert.equal(calls.reply.length, 0);
  assert.equal(calls.replyWithMarkdown[0][0], TEXT.help(true));
});

test('start: a plain /start in DM welcomes the user (no admin-only error)', async () => {
  const { start } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ chatType: 'private' });

  await start(ctx, async () => {});

  assert.equal(calls.reply.length, 0); // no adminOnly ephemeral
  assert.equal(calls.replyWithMarkdown[0][0], TEXT.help(false));
});

test('start: an offline deep link in DM yields to the offline handler', async () => {
  const { start } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ chatType: 'private' });
  ctx.startPayload = 'offline';

  let nextCalled = false;
  await start(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('start: a student join deep link in DM yields to the student handler', async () => {
  const { start } = createHandlers({ storage: makeStorage() });
  const { ctx } = makeCtx({ chatType: 'private' });
  ctx.startPayload = 'hw-5-2';

  let nextCalled = false;
  await start(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('help: always replies, with admin flag reflecting membership', async () => {
  const { help } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ admin: true });

  await help(ctx);

  assert.equal(calls.replyWithMarkdown[0][0], TEXT.help(true));
});

test('myid: in a group records a pending registration and replies with id', async () => {
  let savedGroup = null;
  let savedRows = null;
  const storage = makeStorage({
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async (groupId, rows) => { savedGroup = groupId; savedRows = rows; },
  });
  const { myid } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ chatType: 'group', userId: 42 });

  await myid(ctx);

  assert.equal(savedGroup, '123');
  assert.equal(savedRows.length, 1);
  assert.equal(savedRows[0].userId, '42');
  assert.equal(calls.reply.length, 2);
  assert.match(calls.reply[1][0], /42/);
});

test('myid: in a private chat does not touch pending registrations', async () => {
  let saved = false;
  const storage = makeStorage({ savePendingRegistrations: async () => { saved = true; } });
  const { myid } = createHandlers({ storage });
  const { ctx } = makeCtx({ chatType: 'private' });

  await myid(ctx);

  assert.equal(saved, false);
});

test('groupid: in a private chat replies with the group-only notice', async () => {
  const { groupid } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ chatType: 'private', admin: true });

  await groupid(ctx);

  assert.equal(calls.reply[0][0], TEXT.groupIdPrivateChat);
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('groupid: non-admin in a group is rejected with adminOnly', async () => {
  const { groupid } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ chatType: 'supergroup' });

  await groupid(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('groupid: admin in a group replies with the chat id', async () => {
  const { groupid } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx({ chatType: 'supergroup', chatId: -1001234567890, admin: true });

  await groupid(ctx);

  assert.equal(calls.replyWithMarkdown[0][0], TEXT.groupIdInfo('-1001234567890'));
  assert.match(calls.replyWithMarkdown[0][0], /-1001234567890/);
});

test('registerCmd: non-admin is rejected', async () => {
  const { registerCmd } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx();

  await registerCmd(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
  assert.equal(calls.replyWithMarkdown.length, 0);
});
