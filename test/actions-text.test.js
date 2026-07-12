import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/text.js';
import { archivedSessionKey } from '../lib/historyUtils.js';
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

test('onText: historyEditVerse writes the verse to the archived session and refreshes the editor', async () => {
  const session = {
    type: 'registeredSecondary',
    seriesId: 2,
    name: 'تصحيح',
    startedAt: '2026-07-11T13:00:00.000Z',
    endedAt: '2026-07-11T15:00:00.000Z',
    participants: { 'بكر': { name: 'بكر', memberId: '200', status: 'present', called: null, verse: null } },
  };
  let saved = null;
  const pending = {
    action: 'historyEditVerse', groupId: '123', chatId: 123, msgId: 555,
    series: 2, recordIndex: 1, recordKey: archivedSessionKey(session), token: 'u200', verseListPage: 0,
    memberName: 'بكر', sessionType: 'registeredSecondary', promptMsgId: 556, awaitingPrompt: false,
  };
  const storage = makeStorage({
    getAwaiting: async () => pending,
    delAwaiting: async () => {},
    getSessions: async () => [session],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'آل عمران 10-15' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.ok(saved, 'saveSessions was called');
  assert.equal(saved[0].participants['بكر'].verse, 'آل عمران 10-15');
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the editor message');
});

test('onText: historyEditTitle renames the archived session and refreshes the editor', async () => {
  const session = {
    type: 'main',
    seriesId: 2,
    name: 'مجلس',
    startedAt: '2026-07-11T13:00:00.000Z',
    endedAt: '2026-07-11T15:00:00.000Z',
    participants: { 'بكر': { name: 'بكر', memberId: '200', status: null, called: null } },
  };
  let saved = null;
  const pending = {
    action: 'historyEditTitle', groupId: '123', chatId: 123, msgId: 555,
    series: 2, recordIndex: 1, recordKey: archivedSessionKey(session),
    sessionType: 'main', memberPage: 0, promptMsgId: 556, awaitingPrompt: false,
  };
  const storage = makeStorage({
    getAwaiting: async () => pending,
    delAwaiting: async () => {},
    getSessions: async () => [session],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'مجلس التلاوة' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.ok(saved, 'saveSessions was called');
  assert.equal(saved[0].name, 'مجلس التلاوة');
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the editor message');
});

