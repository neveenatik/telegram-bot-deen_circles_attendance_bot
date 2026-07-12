import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/history.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

function historyStorage(overrides = {}) {
  return makeStorage({
    getAllSessions: async () => [],
    getSessions: async () => [],
    saveSessions: async () => {},
    ...overrides,
  });
}

test('home: non-admin is rejected', async () => {
  const { home } = createHandlers({ storage: historyStorage() });
  const { ctx, calls } = makeCtx({ match: ['h:home:123:2', '123', '2'] });

  await home(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('home: admin with no records answers noSeriesRecords', async () => {
  const { home } = createHandlers({ storage: historyStorage({ getAllSessions: async () => [] }) });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:home:123:2', '123', '2'] });

  await home(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSeriesRecords(2)]]);
});

test('home: admin with records edits the message and answers refreshed', async () => {
  const sessions = [{ seriesId: 2, name: 'جلسة', participants: {} }];
  const { home } = createHandlers({ storage: historyStorage({ getAllSessions: async () => sessions }) });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:home:123:2', '123', '2'] });

  await home(ctx);

  assert.equal(calls.editMessageText.length, 1);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.refreshed]]);
});

// Archived-session editor targets members by their Telegram userId (`u<id>`)
// token, so a status edit hits the intended person regardless of where they
// land in the alphabetically sorted list (the source of the earlier
// "member does not exist" / wrong-member regression).
function editorSession() {
  return {
    seriesId: 2,
    type: 'main',
    name: 'مجلس',
    startedAt: '2026-07-11T13:00:00.000Z',
    endedAt: '2026-07-11T15:00:00.000Z',
    participants: {
      'بكر': { name: 'بكر', memberId: '200', status: null, called: null },
      'أحمد': { name: 'أحمد', memberId: '100', status: null, called: null },
    },
  };
}

test('setStatus: userId token targets the correct member regardless of sort order', async () => {
  let saved = null;
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    getSessions: async () => [editorSession()],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const { setStatus } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({
    admin: true,
    match: ['h:set:123:2:1:u200:present', '123', '2', '1', 'u200', 'present'],
  });

  await setStatus(ctx);

  assert.ok(saved, 'saveSessions was called');
  assert.equal(saved[0].participants['بكر'].status, 'present');
  assert.equal(saved[0].participants['أحمد'].status, null);
  assert.equal(calls.answerCbQuery.length, 1);
});

test('setStatus: unknown userId token answers memberNotFound and does not save', async () => {
  let saved = null;
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    getSessions: async () => [editorSession()],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const { setStatus } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({
    admin: true,
    match: ['h:set:123:2:1:u999:present', '123', '2', '1', 'u999', 'present'],
  });

  await setStatus(ctx);

  assert.equal(saved, null);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('pick: userId token opens the status menu for the matching member', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const { pick } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({
    admin: true,
    match: ['h:pick:123:2:1:u100', '123', '2', '1', 'u100'],
  });

  await pick(ctx);

  assert.equal(calls.editMessageText.length, 1);
  assert.ok(calls.editMessageText[0][0].includes('أحمد'));
});

// Recitation-correction (registeredSecondary) archived sessions expose per-member
// verse editing on top of attendance status.
function recitationSession() {
  return {
    seriesId: 2,
    type: 'registeredSecondary',
    name: 'تصحيح',
    startedAt: '2026-07-11T13:00:00.000Z',
    endedAt: '2026-07-11T15:00:00.000Z',
    participants: {
      'بكر': { name: 'بكر', memberId: '200', status: null, called: null, verse: 'البقرة 1-5', registeredAt: 2 },
      'أحمد': { name: 'أحمد', memberId: '100', status: null, called: null, verse: null, registeredAt: 1 },
    },
  };
}

test('pick: registeredSecondary shows the current verse and an edit-verse button', async () => {
  const storage = historyStorage({ getAllSessions: async () => [recitationSession()] });
  const { pick } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:pick:123:2:1:u200', '123', '2', '1', 'u200'] });

  await pick(ctx);

  assert.equal(calls.editMessageText.length, 1);
  const [text, extra] = calls.editMessageText[0];
  assert.ok(text.includes('البقرة 1-5'), 'shows the current verse');
  const buttons = extra.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'h:everse:123:2:1:u200'), 'has edit-verse button');
});

test('editVerse: registeredSecondary sets awaiting and sends a force-reply prompt', async () => {
  const awaits = [];
  const storage = historyStorage({
    getAllSessions: async () => [recitationSession()],
    getAwaiting: async () => null,
    setAwaiting: async (...a) => { awaits.push(a); },
  });
  const { editVerse } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:everse:123:2:1:u200', '123', '2', '1', 'u200'] });

  await editVerse(ctx);

  assert.equal(calls.reply.length, 1, 'sends a prompt');
  assert.equal(calls.reply[0][1].reply_markup.force_reply, true);
  const record = awaits[awaits.length - 1][2];
  assert.equal(record.action, 'historyEditVerse');
  assert.equal(record.memberName, 'بكر');
  assert.equal(record.token, 'u200');
  assert.equal(record.sessionType, 'registeredSecondary');
});

test('editVerse: non-recitation session answers memberNotFound', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const { editVerse } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:everse:123:2:1:u100', '123', '2', '1', 'u100'] });

  await editVerse(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

