import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers as rawCreateHandlers } from '../lib/handlers/actions/history.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

// The history panel is delivered to DM, so its handlers verify admin via
// isAdminOf(telegram, groupId, userId). Supply a telegram whose getChatMember
// reports the desired membership status (default: administrator).
function createHandlers({ storage }, memberStatus = 'administrator') {
  return rawCreateHandlers({
    storage,
    telegram: makeTelegram({ getChatMember: async () => ({ status: memberStatus }) }),
  });
}

function historyStorage(overrides = {}) {
  // getAllSessions now returns metadata-only records; the handlers hydrate a
  // picked record's roster via getSessionParticipants. Mirror that here: attach
  // a stable synthetic id to each fixture session and derive a matching
  // getSessionParticipants from the same fixtures so existing tests (which put
  // participants on their getAllSessions fixtures) keep working unchanged.
  const rawGetAll = overrides.getAllSessions || (async () => []);
  const getAllSessions = async (...args) => {
    const list = await rawGetAll(...args);
    return (list || []).map((s, i) => (s && s.id == null ? { ...s, id: `sid-${i}` } : s));
  };
  const store = makeStorage({
    getSessions: async () => [],
    saveSessions: async () => {},
    ...overrides,
    getAllSessions,
  });
  if (!overrides.getSessionParticipants) {
    store.getSessionParticipants = async (_groupId, ids) => {
      const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
      const list = await getAllSessions();
      const out = {};
      for (const s of list) if (wanted.has(String(s.id))) out[s.id] = s.participants || {};
      return out;
    };
  }
  return store;
}

test('home: non-admin is rejected', async () => {
  const { home } = createHandlers({ storage: historyStorage() }, 'member');
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

// ── Delete session (shared by live history + offline) ────────────────────────
function editorKb(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

test('session editor shows a delete button (live history)', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const { session } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:session:123:2:1:0', '123', '2', '1', '0'] });

  await session(ctx);

  assert.ok(editorKb(calls).includes('h:sdel:123:2:1:0'), 'delete button present');
});

test('deleteSessionPrompt: shows a confirm step without deleting', async () => {
  let called = false;
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    deleteSession: async () => { called = true; return { ok: true }; },
  });
  const { deleteSessionPrompt } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:sdel:123:2:1:0', '123', '2', '1', '0'] });

  await deleteSessionPrompt(ctx);

  assert.equal(called, false, 'delete not performed at prompt stage');
  const cbs = editorKb(calls);
  assert.ok(cbs.includes('h:sdelx:123:2:1'), 'confirm button present');
  assert.ok(cbs.includes('h:session:123:2:1:0'), 'cancel returns to editor');
});

test('deleteSessionConfirm: removes the picked session by id', async () => {
  let deletedId = null;
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    deleteSession: async (_g, id) => { deletedId = id; return { ok: true }; },
  });
  const { deleteSessionConfirm } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:sdelx:123:2:1', '123', '2', '1'] });

  await deleteSessionConfirm(ctx);

  assert.equal(deletedId, 'sid-0');
  assert.equal(calls.editMessageText.length, 1);
  assert.equal(calls.answerCbQuery.length, 1);
});

test('deleteSessionConfirm: denied when caps.deleteSession is false (assistant)', async () => {
  let called = false;
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    deleteSession: async () => { called = true; return { ok: true }; },
  });
  const resolveContext = async () => ({ ok: true, groupId: '5', gref: '5', caps: { deleteSession: false } });
  const { deleteSessionConfirm } = rawCreateHandlers({ storage, resolveContext, ns: 'o' });
  const { ctx, calls } = makeCtx({ match: ['o:sdelx:5:2:1', '5', '2', '1'] });

  await deleteSessionConfirm(ctx);

  assert.equal(called, false);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('session editor hides the delete button when caps.deleteSession is false', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const resolveContext = async () => ({ ok: true, groupId: '5', gref: '5', caps: { deleteSession: false } });
  const { session } = rawCreateHandlers({ storage, resolveContext, ns: 'o' });
  const { ctx, calls } = makeCtx({ match: ['o:session:5:2:1:0', '5', '2', '1', '0'] });

  await session(ctx);

  assert.ok(!editorKb(calls).some((c) => c && c.startsWith('o:sdel:')), 'no delete button for assistant');
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
      'بكر': { name: 'بكر', memberId: '200', status: 'present', called: null, verse: 'البقرة 1-5', registeredAt: 2 },
      'أحمد': { name: 'أحمد', memberId: '100', status: 'listening', called: null, verse: null, registeredAt: 1 },
      'خالد': { name: 'خالد', memberId: '300', status: 'absent', called: null, verse: null, registeredAt: 3 },
    },
  };
}

test('session: registeredSecondary editor exposes an edit-verses button', async () => {
  const storage = historyStorage({ getAllSessions: async () => [recitationSession()] });
  const { session } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:session:123:2:1:0', '123', '2', '1', '0'] });

  await session(ctx);

  const buttons = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'h:vlist:123:2:1:0'), 'has edit-verses button');
});

test('verseList: lists only present/listening students with verse-edit buttons', async () => {
  const storage = historyStorage({ getAllSessions: async () => [recitationSession()] });
  const { verseList } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:vlist:123:2:1:0', '123', '2', '1', '0'] });

  await verseList(ctx);

  assert.equal(calls.editMessageText.length, 1);
  const [text, extra] = calls.editMessageText[0];
  assert.ok(text.includes('البقرة 1-5'), 'shows the current verse');
  const buttons = extra.reply_markup.inline_keyboard.flat();
  const verseButtons = buttons.filter((b) => b.callback_data.startsWith('h:everse:'));
  assert.equal(verseButtons.length, 2, 'only present + listening students are listed');
  assert.ok(verseButtons.some((b) => b.callback_data === 'h:everse:123:2:1:u200:v0'), 'present student button carries the list page');
  assert.ok(!buttons.some((b) => b.callback_data.includes('u300')), 'absent student is excluded');
});

test('editVerse: registeredSecondary sets awaiting and sends a force-reply prompt', async () => {
  const awaits = [];
  const storage = historyStorage({
    getAllSessions: async () => [recitationSession()],
    setReplyPrompt: async (...a) => { awaits.push(a); },
  });
  const { editVerse } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:everse:123:2:1:u200:v0', '123', '2', '1', 'u200', '0'] });

  await editVerse(ctx);

  assert.equal(calls.reply.length, 1, 'sends a prompt');
  assert.equal(calls.reply[0][1].reply_markup.force_reply, true);
  const record = awaits[awaits.length - 1][2];
  assert.equal(record.action, 'historyEditVerse');
  assert.equal(record.memberName, 'بكر');
  assert.equal(record.token, 'u200');
  assert.equal(record.verseListPage, 0);
  assert.equal(record.sessionType, 'registeredSecondary');
});

test('editVerse: non-recitation session answers memberNotFound', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const { editVerse } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:everse:123:2:1:u100:v0', '123', '2', '1', 'u100', '0'] });

  await editVerse(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('pick: registeredSecondary member menu exposes attendedMain and backup toggles', async () => {
  const storage = historyStorage({ getAllSessions: async () => [recitationSession()] });
  const { pick } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:pick:123:2:1:u200', '123', '2', '1', 'u200'] });

  await pick(ctx);

  const buttons = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'h:rflag:123:2:1:u200:main:1'), 'has attended-main toggle');
  assert.ok(buttons.some((b) => b.callback_data === 'h:rflag:123:2:1:u200:main:0'), 'has no-main toggle');
  assert.ok(buttons.some((b) => b.callback_data === 'h:rflag:123:2:1:u200:backup:1'), 'has backup-on toggle');
  assert.ok(buttons.some((b) => b.callback_data === 'h:rflag:123:2:1:u200:backup:0'), 'has backup-off toggle');
});

test('setReciteFlag: sets attendedMain=false and persists', async () => {
  let saved = null;
  const storage = historyStorage({
    getAllSessions: async () => [recitationSession()],
    getSessions: async () => [recitationSession()],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const { setReciteFlag } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({
    admin: true,
    match: ['h:rflag:123:2:1:u200:main:0', '123', '2', '1', 'u200', 'main', '0'],
  });

  await setReciteFlag(ctx);

  assert.ok(saved, 'saveSessions was called');
  assert.equal(saved[0].participants['بكر'].attendedMain, false);
  assert.equal(calls.editMessageText.length, 1, 'refreshes the member menu in place');
  assert.equal(calls.answerCbQuery.length, 1);
});

test('setReciteFlag: sets backup=true and persists', async () => {
  let saved = null;
  const storage = historyStorage({
    getAllSessions: async () => [recitationSession()],
    getSessions: async () => [recitationSession()],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const { setReciteFlag } = createHandlers({ storage });
  const { ctx } = makeCtx({
    admin: true,
    match: ['h:rflag:123:2:1:u100:backup:1', '123', '2', '1', 'u100', 'backup', '1'],
  });

  await setReciteFlag(ctx);

  assert.equal(saved[0].participants['أحمد'].backup, true);
});

test('setReciteFlag: non-recitation session answers memberNotFound and does not save', async () => {
  let saved = null;
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    getSessions: async () => [editorSession()],
    saveSessions: async (_g, _t, sessions) => { saved = sessions; },
  });
  const { setReciteFlag } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({
    admin: true,
    match: ['h:rflag:123:2:1:u200:main:0', '123', '2', '1', 'u200', 'main', '0'],
  });

  await setReciteFlag(ctx);

  assert.equal(saved, null);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('session: editor exposes an edit-title button for the record', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const { session } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:session:123:2:1:0', '123', '2', '1', '0'] });

  await session(ctx);

  assert.equal(calls.editMessageText.length, 1);
  const buttons = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === 'h:etitle:123:2:1:0'), 'has edit-title button');
});

test('editTitle: sets awaiting and sends a force-reply prompt', async () => {
  const awaits = [];
  const storage = historyStorage({
    getAllSessions: async () => [editorSession()],
    setReplyPrompt: async (...a) => { awaits.push(a); },
  });
  const { editTitle } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:etitle:123:2:1:0', '123', '2', '1', '0'] });

  await editTitle(ctx);

  assert.equal(calls.reply.length, 1, 'sends a prompt');
  assert.equal(calls.reply[0][1].reply_markup.force_reply, true);
  const record = awaits[awaits.length - 1][2];
  assert.equal(record.action, 'historyEditTitle');
  assert.equal(record.recordIndex, 1);
  assert.equal(record.sessionType, 'main');
});

test('editTitle: invalid record index answers invalidRecordIndex', async () => {
  const storage = historyStorage({ getAllSessions: async () => [editorSession()] });
  const { editTitle } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:etitle:123:2:9:0', '123', '2', '9', '0'] });

  await editTitle(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.invalidRecordIndex]]);
});

