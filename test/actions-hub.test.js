import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/hub.js';
import { makeCtx, makeTelegram, makeStorage } from './mocks.js';
import { TEXT } from '../lib/text.js';

const HUB = TEXT.manageHub;

function cbData(calls, method) {
  return (calls[method][0][1].reply_markup.inline_keyboard || [])
    .flat()
    .map((b) => b.callback_data);
}

test('/manage delivers the hub to the admin DM and acks in group', async () => {
  const { ctx, calls, telegram } = makeCtx({ chatType: 'group', admin: true, chatId: 123 });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.manage(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], ctx.from.id);
  assert.equal(telegram.calls.sendMessage[0][1], HUB.title);
  const data = telegram.calls.sendMessage[0][2].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(data, ['mg:members:123', 'mg:pending:123', 'mg:history:123', 'o:root', 'msg:dismiss']);
  assert.equal(calls.reply[0][0], TEXT.panelSentToDm);
});

test('/manage is admin-only', async () => {
  const { ctx, calls, telegram } = makeCtx({ chatType: 'group', admin: false });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.manage(ctx);

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('/manage falls back to a start-in-DM nudge when the DM send fails', async () => {
  const telegram = makeTelegram({ sendMessage: async () => { throw new Error('bot was blocked'); } });
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.manage(ctx);

  assert.match(calls.reply[0][0], /start=manage/);
});

test('mg:home re-renders the hub in place', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ match: ['mg:home:123', '123'] });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.home(ctx);

  assert.equal(calls.editMessageText[0][0], HUB.title);
  assert.deepEqual(cbData(calls, 'editMessageText'), ['mg:members:123', 'mg:pending:123', 'mg:history:123', 'o:root', 'msg:dismiss']);
});

test('mg:members opens the members panel with a back-to-hub row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getMaster: async () => ({ members: [{ name: 'سارة' }] }) });
  const { ctx, calls } = makeCtx({ match: ['mg:members:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openMembers(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.includes('msg:dismiss'), 'keeps the close row');
  assert.ok(data.some((d) => d.startsWith('mb:123:')), 'renders members buttons');
});

test('mg:pending opens the pending panel with a back-to-hub row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getPendingRegistrations: async () => [{ userId: 7, name: 'مريم' }] });
  const { ctx, calls } = makeCtx({ match: ['mg:pending:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openPending(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.includes('msg:dismiss'), 'keeps the close row');
});

test('mg:history opens the history home with a back-to-hub row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({
    getAllSessions: async () => [{ type: 'main', seriesId: 1, name: 'جلسة', startedAt: 1 }],
    getCurrentSeries: async () => 1,
  });
  const { ctx, calls } = makeCtx({ match: ['mg:history:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openHistory(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.some((d) => d.startsWith('h:rep:123:')), 'renders history actions');
});

test('mg:history alerts when the current series has no records', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getAllSessions: async () => [], getCurrentSeries: async () => 3 });
  const { ctx, calls } = makeCtx({ match: ['mg:history:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openHistory(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.noSeriesRecords(3));
});

test('mg: actions are gated to admins of the originating group', async () => {
  const telegram = makeTelegram({ getChatMember: async () => ({ status: 'member' }) });
  const storage = makeStorage({ getMaster: async () => ({ members: [] }) });
  const { ctx, calls } = makeCtx({ match: ['mg:members:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openMembers(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});
