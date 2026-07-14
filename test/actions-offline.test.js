import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/offline.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

const OWNER = 999;

function offlineStorage(overrides = {}) {
  return makeStorage({
    getOfflineClassById: async (rowId) =>
      String(rowId) === '5'
        ? { groupId: 'offline:999:abc', name: 'صف الفجر', ownerUserId: String(OWNER), rowId: 5 }
        : null,
    listOfflineClasses: async () => [{ groupId: 'offline:999:abc', name: 'صف الفجر', rowId: 5 }],
    getMaster: async () => ({ members: [
      { userId: 'offline:u1', name: 'مريم', listNumber: 1 },
      { userId: 'offline:u2', name: 'خديجة', listNumber: 2 },
    ] }),
    getTeachers: async () => [{ id: 7, userId: 'offline:t1', name: 'أمل', type: 'courseteacher' }],
    getSessions: async () => [],
    saveSessions: async () => {},
    getAllSessions: async () => [],
    getSessionTeacher: async () => null,
    assignSessionTeacher: async () => ({ ok: true }),
    setReplyPrompt: async () => {},
    ...overrides,
  });
}

function handlers(storage) {
  return createHandlers({ storage, telegram: makeTelegram() });
}

test('classHome: non-owner is rejected', async () => {
  const { classHome } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: 111, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
});

test('classHome: unknown class answers notFound', async () => {
  const { classHome } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:cls:404', '404'] });
  await classHome(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.offline.notFound]]);
});

test('classHome: owner sees the class panel', async () => {
  const { classHome } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  assert.equal(calls.editMessageText.length, 1);
  assert.match(calls.editMessageText[0][0], /صف الفجر/);
});

test('roster: lists students for owner', async () => {
  const { roster } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:roster:5:0', '5', '0'] });
  await roster(ctx);
  assert.equal(calls.editMessageText.length, 1);
  // Students are rendered as tappable buttons (by list number), not body text.
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const labels = kb.flat().map((b) => b.text).join(' ');
  assert.match(labels, /مريم/);
  assert.match(labels, /خديجة/);
});

test('roster: orders students by list number, not the alphabet', async () => {
  const store = offlineStorage({
    getMaster: async () => ({ members: [
      { userId: 'offline:u2', name: 'خديجة', listNumber: 2 },
      { userId: 'offline:u1', name: 'مريم', listNumber: 1 },
    ] }),
  });
  const { roster } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:roster:5:0', '5', '0'] });
  await roster(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const studentRows = kb.flat().filter((b) => /^\d+\./.test(b.text));
  assert.match(studentRows[0].text, /^1\. مريم/);
  assert.match(studentRows[1].text, /^2\. خديجة/);
  assert.equal(studentRows[0].callback_data, 'o:stu:5:1:0');
});

test('studentMenu: owner sees rename/remove options', async () => {
  const { studentMenu } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:stu:5:1:0', '5', '1', '0'] });
  await studentMenu(ctx);
  assert.equal(calls.editMessageText.length, 1);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:srename:5:1:0'));
  assert.ok(data.includes('o:sremove:5:1:0'));
});

test('studentMenu: unknown list number answers not found', async () => {
  const { studentMenu } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:stu:5:99:0', '5', '99', '0'] });
  await studentMenu(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.offline.studentNotFound]]);
});

test('removeStudent: soft-deletes and refreshes the roster', async () => {
  let removedWith = null;
  const store = offlineStorage({
    removeOfflineStudent: async (gid, ln) => { removedWith = { gid, ln }; return { ok: true, name: 'مريم' }; },
    getMaster: async () => ({ members: [{ userId: 'offline:u2', name: 'خديجة', listNumber: 2 }] }),
  });
  const { removeStudent } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sremx:5:1:0', '5', '1', '0'] });
  await removeStudent(ctx);
  assert.deepEqual(removedWith, { gid: 'offline:999:abc', ln: '1' });
  assert.equal(calls.editMessageText.length, 1);
});

test('createSession: seeds roster participants and saves the session', async () => {
  const saved = [];
  const store = offlineStorage({
    saveSessions: async (gid, type, list) => { saved.push({ gid, type, list }); },
  });
  const { createSession } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mksess:5:main', '5', 'main'] });
  await createSession(ctx);

  assert.equal(saved.length, 1);
  assert.equal(saved[0].type, 'main');
  assert.equal(saved[0].list.length, 1);
  const session = saved[0].list[0];
  assert.equal(session.type, 'main');
  assert.equal(session.seriesId, 1);
  assert.equal(session.active, false);
  assert.deepEqual(Object.keys(session.participants).sort(), ['خديجة', 'مريم']);
  assert.equal(session.participants['مريم'].memberId, 'offline:u1');
  assert.equal(session.participants['مريم'].status, null);
  assert.equal(calls.editMessageText.length, 1);
});

const MIXED_SESSIONS = [
  { id: 'm1', seriesId: 1, type: 'main', name: 'حلقة أ', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:00Z', participants: {} },
  { id: 't1', seriesId: 1, type: 'training', name: 'تدريب أ', startedAt: '2026-01-02T00:00:00Z', endedAt: '2026-01-02T00:00:00Z', participants: {} },
  { id: 'm2', seriesId: 1, type: 'main', name: 'حلقة ب', startedAt: '2026-01-03T00:00:00Z', endedAt: '2026-01-03T00:00:00Z', participants: {} },
];

test('sessionTypesMenu: shows a type chooser with per-type counts', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { sessionTypesMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sessions:5', '5'] });
  await sessionTypesMenu(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:stype:5:main:0'));
  assert.ok(data.includes('o:stype:5:training:0'));
  const mainLabel = kb.flat().find((b) => b.callback_data === 'o:stype:5:main:0').text;
  assert.match(mainLabel, /2/);
});

test('sessionsByType: lists only the type, preserving absolute record index', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { sessionsByType } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:stype:5:main:0', '5', 'main', '0'] });
  await sessionsByType(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const sessionButtons = kb.flat().filter((b) => /^o:smenu:/.test(b.callback_data));
  assert.equal(sessionButtons.length, 2);
  assert.deepEqual(sessionButtons.map((b) => b.callback_data), ['o:smenu:5:1:1', 'o:smenu:5:1:3']);
});

test('sessionMenu: back button returns to the session type list', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { sessionMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:smenu:5:1:3', '5', '1', '3'] });
  await sessionMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:stype:5:main:0'));
});

test('assignTeacher: assigns the picked teacher to the session', async () => {
  let assigned = null;
  const store = offlineStorage({
    getAllSessions: async () => [{ id: 'sid-1', seriesId: 1, type: 'main', name: 'حلقة', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:00Z', participants: {} }],
    assignSessionTeacher: async (gid, sessionId, teacherId) => { assigned = { gid, sessionId, teacherId }; return { ok: true }; },
    getSessionTeacher: async () => ({ id: 7, name: 'أمل', type: 'courseteacher' }),
  });
  const { assignTeacher } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:asg:5:1:1:7', '5', '1', '1', '7'] });
  await assignTeacher(ctx);

  assert.deepEqual(assigned, { gid: 'offline:999:abc', sessionId: 'sid-1', teacherId: 7 });
  assert.deepEqual(calls.answerCbQuery, [[TEXT.offline.teacherAssigned('أمل')]]);
});

test('assignTeacher: teacherId 0 clears the assignment', async () => {
  let assigned = null;
  const store = offlineStorage({
    getAllSessions: async () => [{ id: 'sid-1', seriesId: 1, type: 'main', name: 'حلقة', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:00Z', participants: {} }],
    assignSessionTeacher: async (gid, sessionId, teacherId) => { assigned = { gid, sessionId, teacherId }; return { ok: true }; },
  });
  const { assignTeacher } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:asg:5:1:1:0', '5', '1', '1', '0'] });
  await assignTeacher(ctx);

  assert.equal(assigned.teacherId, null);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.offline.teacherCleared]]);
});

test('entry: renders the class list in a private chat', async () => {
  const { entry } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ chatType: 'private', userId: OWNER, text: '/offline' });
  await entry(ctx);
  assert.equal(calls.reply.length, 1);
  assert.match(calls.reply[0][0], /صفوفي|صف الفجر/);
});
