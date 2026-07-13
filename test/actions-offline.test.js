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
  assert.match(calls.editMessageText[0][0], /مريم/);
  assert.match(calls.editMessageText[0][0], /خديجة/);
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
