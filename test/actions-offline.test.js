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
    // Owner resolves with role 'owner'; anyone else is unauthorized unless a test
    // overrides this to model a delegate (operator/assistant).
    resolveManageableClass: async (rowId, userId) => {
      if (String(rowId) !== '5') return null;
      const base = { groupId: 'offline:999:abc', name: 'صف الفجر', ownerUserId: String(OWNER), rowId: 5 };
      if (String(userId) === String(OWNER)) return { ...base, role: 'owner' };
      return null;
    },
    listOfflineClasses: async () => [{ groupId: 'offline:999:abc', name: 'صف الفجر', rowId: 5 }],
    listSharedClasses: async () => [],
    listClassManagers: async () => [],
    addClassManager: async () => ({ ok: true, role: 'operator' }),
    setClassManagerRole: async () => ({ ok: true, role: 'operator' }),
    removeClassManager: async () => ({ ok: true }),
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
  assert.deepEqual(calls.answerCbQuery, [[TEXT.offline.notFound]]);
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

test('sessionTypesMenu: exposes the class-level all-sessions view', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { sessionTypesMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sessions:5', '5'] });
  await sessionTypesMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:allsess:5:0'));
});

test('allSessions: lists every type in one view, keeping absolute record indices', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { allSessions } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:allsess:5:0', '5', '0'] });
  await allSessions(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const sessionButtons = kb.flat().filter((b) => /^o:smenu:/.test(b.callback_data));
  assert.deepEqual(sessionButtons.map((b) => b.callback_data), ['o:smenu:5:1:1', 'o:smenu:5:1:2', 'o:smenu:5:1:3']);
});

test('sessionMenu: owner sees a delete-session button', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { sessionMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:smenu:5:1:3', '5', '1', '3'] });
  await sessionMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:sdel:5:1:3'));
});

test('sessionDeleteConfirm: shows a confirm button for the picked session', async () => {
  const store = offlineStorage({ getAllSessions: async () => MIXED_SESSIONS });
  const { sessionDeleteConfirm } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sdel:5:1:3', '5', '1', '3'] });
  await sessionDeleteConfirm(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:sdelx:5:1:3'));
});

test('sessionDelete: removes the session by its row id and re-renders the list', async () => {
  const deleted = [];
  let call = 0;
  const store = offlineStorage({
    // First read returns all three; after delete, m2 is gone.
    getAllSessions: async () => {
      call += 1;
      return call <= 1 ? MIXED_SESSIONS : MIXED_SESSIONS.filter((s) => s.id !== 'm2');
    },
    deleteSession: async (gid, id) => { deleted.push([gid, id]); return { ok: true }; },
  });
  const { sessionDelete } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sdelx:5:1:3', '5', '1', '3'] });
  await sessionDelete(ctx);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0][1], 'm2'); // the third session's row id
  assert.equal(calls.answerCbQuery[0][0], TEXT.offline.sessionDeletedToast('حلقة ب'));
  const sessionButtons = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().filter((b) => /^o:smenu:/.test(b.callback_data));
  assert.equal(sessionButtons.length, 2);
});

test('sessionMenu: hides the delete button for an assistant', async () => {
  const store = withRole('assistant', { getAllSessions: async () => MIXED_SESSIONS });
  const { sessionMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:smenu:5:1:3', '5', '1', '3'] });
  await sessionMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(!data.includes('o:sdel:5:1:3'));
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

// ── Delegation (co-managers) ─────────────────────────────────────────────────

const DELEGATE = 111;

// Resolve DELEGATE with the given role; OWNER stays owner; others unauthorized.
function withRole(role, overrides = {}) {
  return offlineStorage({
    resolveManageableClass: async (rowId, userId) => {
      if (String(rowId) !== '5') return null;
      const base = { groupId: 'offline:999:abc', name: 'صف الفجر', ownerUserId: String(OWNER), rowId: 5 };
      if (String(userId) === String(OWNER)) return { ...base, role: 'owner' };
      if (String(userId) === String(DELEGATE)) return { ...base, role };
      return null;
    },
    ...overrides,
  });
}

function classHomeData(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

test('classHome: owner sees rename + managers buttons', async () => {
  const { classHome } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  const data = classHomeData(calls);
  assert.ok(data.includes('o:crename:5'));
  assert.ok(data.includes('o:mgrs:5'));
  assert.ok(data.includes('o:roster:5:0'));
});

test('classHome: operator hides rename but shows managers + clone', async () => {
  const { classHome } = handlers(withRole('operator'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  const data = classHomeData(calls);
  assert.ok(!data.includes('o:crename:5')); // renaming the class stays owner-only
  assert.ok(data.includes('o:mgrs:5')); // operators manage assistants
  assert.ok(data.includes('o:clone:5')); // operators may clone a shared class
  assert.ok(data.includes('o:roster:5:0'));
  assert.ok(data.includes('o:newsess:5'));
  assert.ok(data.includes('o:teach:5'));
});

test('classHome: assistant sees only sessions + report', async () => {
  const { classHome } = handlers(withRole('assistant'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  const data = classHomeData(calls);
  assert.ok(data.includes('o:sessions:5'));
  assert.ok(data.includes('o:rep:5:1'));
  assert.ok(!data.includes('o:roster:5:0'));
  assert.ok(!data.includes('o:teach:5'));
  assert.ok(!data.includes('o:newsess:5'));
  assert.ok(!data.includes('o:crename:5'));
  assert.ok(!data.includes('o:mgrs:5'));
});

test('roster: assistant is denied', async () => {
  const { roster } = handlers(withRole('assistant'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:roster:5:0', '5', '0'] });
  await roster(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
});

test('roster: operator is allowed', async () => {
  const { roster } = handlers(withRole('operator'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:roster:5:0', '5', '0'] });
  await roster(ctx);
  assert.equal(calls.editMessageText.length, 1);
});

test('sessionTypesMenu: hides New Session button for assistant', async () => {
  const store = withRole('assistant', { getAllSessions: async () => MIXED_SESSIONS });
  const { sessionTypesMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:sessions:5', '5'] });
  await sessionTypesMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(!data.includes('o:newsess:5'));
  assert.ok(data.includes('o:stype:5:main:0'));
});

test('sessionMenu: hides assign-teacher button for assistant', async () => {
  const store = withRole('assistant', { getAllSessions: async () => MIXED_SESSIONS });
  const { sessionMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:smenu:5:1:1', '5', '1', '1'] });
  await sessionMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(!data.some((d) => /^o:asgm:/.test(d)));
  assert.ok(data.includes('o:session:5:1:1:0')); // attendance editor still available
  assert.ok(data.includes('o:report:5:1:1'));
});

test('createSession: assistant is denied', async () => {
  const { createSession } = handlers(withRole('assistant'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:mksess:5:main', '5', 'main'] });
  await createSession(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('teachers: each teacher is a tappable button showing her type', async () => {
  const { teachers } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:teach:5', '5'] });
  await teachers(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:addteach:5'));
  assert.ok(data.includes('o:tch:5:7')); // teacher id 7 from the fixture
  const labels = kb.flat().map((b) => b.text).join(' ');
  assert.match(labels, /أمل/);
});

test('teacherMenu: offers rename, change-type and remove', async () => {
  const { teacherMenu } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tch:5:7', '5', '7'] });
  await teacherMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:tren:5:7'));
  assert.ok(data.includes('o:ttype:5:7'));
  assert.ok(data.includes('o:trm:5:7'));
});

test('renameTeacherPrompt: opens a force-reply awaiting the new name', async () => {
  let record = null;
  const store = offlineStorage({ setReplyPrompt: async (_c, _m, rec) => { record = rec; } });
  const { renameTeacherPrompt } = handlers(store);
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:tren:5:7', '5', '7'] });
  await renameTeacherPrompt(ctx);
  assert.equal(record.action, 'offlineRenameTeacher');
  assert.equal(record.teacherId, '7');
  assert.equal(String(record.gref), '5');
});

test('teacherTypeMenu: lists the types and marks the current one', async () => {
  const { teacherTypeMenu } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttype:5:7', '5', '7'] });
  await teacherTypeMenu(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:ttset:5:7:courseteacher'));
  assert.ok(data.includes('o:ttset:5:7:trainingteacher'));
  assert.ok(data.includes('o:ttset:5:7:recitationteacher'));
  const current = kb.flat().find((b) => b.callback_data === 'o:ttset:5:7:courseteacher');
  assert.match(current.text, /✅/); // current type is marked
});

test('setTeacherType: changes the type and refreshes the teacher menu', async () => {
  let changed = null;
  const store = offlineStorage({
    setOfflineTeacherType: async (gid, id, type) => { changed = { gid, id, type }; return { ok: true, name: 'أمل', type }; },
    getTeachers: async () => [{ id: 7, userId: 'offline:t1', name: 'أمل', type: 'trainingteacher' }],
  });
  const { setTeacherType } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttset:5:7:trainingteacher', '5', '7', 'trainingteacher'] });
  await setTeacherType(ctx);
  assert.equal(changed.id, '7');
  assert.equal(changed.type, 'trainingteacher');
  assert.equal(calls.editMessageText.length, 1);
});

test('removeTeacher: soft-deletes and refreshes the teacher list', async () => {
  let removed = null;
  const store = offlineStorage({
    removeOfflineTeacher: async (gid, id) => { removed = { gid, id }; return { ok: true, name: 'أمل' }; },
    getTeachers: async () => [],
  });
  const { removeTeacher } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:trmx:5:7', '5', '7'] });
  await removeTeacher(ctx);
  assert.equal(removed.id, '7');
  assert.equal(calls.editMessageText.length, 1);
});

test('teacherMenu: assistant is denied', async () => {
  const { teacherMenu } = handlers(withRole('assistant'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:tch:5:7', '5', '7'] });
  await teacherMenu(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
});

test('managersMenu: owner lists managers with add button', async () => {
  const store = offlineStorage({
    listClassManagers: async () => [
      { userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' },
      { userId: '222', role: 'assistant', displayName: null, addedBy: '999' },
    ],
  });
  const { managersMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mgrs:5', '5'] });
  await managersMenu(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:mgr:5:111'));
  assert.ok(data.includes('o:mgr:5:222'));
  assert.ok(data.includes('o:mgradd:5'));
  const labels = kb.flat().map((b) => b.text).join(' ');
  assert.match(labels, /هدى/);
  assert.match(labels, /#222/); // fallback to id when no display name
});

test('managersMenu: operator sees only assistants (not other operators)', async () => {
  const store = withRole('operator', {
    listClassManagers: async () => [
      { userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' },
      { userId: '222', role: 'assistant', displayName: 'سارة', addedBy: '999' },
    ],
  });
  const { managersMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:mgrs:5', '5'] });
  await managersMenu(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(!data.includes('o:mgr:5:111')); // other operators are hidden
  assert.ok(data.includes('o:mgr:5:222')); // assistants are manageable
  assert.ok(data.includes('o:mgradd:5'));
});

test('addManagerPrompt: stores the chosen role in the reply prompt', async () => {
  let record = null;
  const store = offlineStorage({ setReplyPrompt: async (_c, _m, rec) => { record = rec; } });
  const { addManagerPrompt } = handlers(store);
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:mgrrole:5:assistant', '5', 'assistant'] });
  await addManagerPrompt(ctx);
  assert.equal(record.action, 'offlineAddManager');
  assert.equal(record.role, 'assistant');
  assert.equal(String(record.gref), '5');
});

test('setManagerRole: changes the role and refreshes the manager menu', async () => {
  let changed = null;
  const store = offlineStorage({
    setClassManagerRole: async (gref, uid, role) => { changed = { gref, uid, role }; return { ok: true, role }; },
    listClassManagers: async () => [{ userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' }],
  });
  const { setManagerRole } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mgrset:5:111:operator', '5', '111', 'operator'] });
  await setManagerRole(ctx);
  assert.deepEqual(changed, { gref: 5, uid: '111', role: 'operator' });
  assert.equal(calls.editMessageText.length, 1);
});

test('renameManagerPrompt: opens a force-reply awaiting the new name', async () => {
  let record = null;
  const store = offlineStorage({
    setReplyPrompt: async (_c, _m, rec) => { record = rec; },
    listClassManagers: async () => [{ userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' }],
  });
  const { renameManagerPrompt } = handlers(store);
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:mgrren:5:111', '5', '111'] });
  await renameManagerPrompt(ctx);
  assert.equal(record.action, 'offlineRenameManager');
  assert.equal(record.uid, '111');
  assert.equal(String(record.gref), '5');
});

test('manager menu offers a rename button', async () => {
  const store = offlineStorage({
    listClassManagers: async () => [{ userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' }],
  });
  const { managerMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mgr:5:111', '5', '111'] });
  await managerMenu(ctx);
  const cbs = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cbs.includes('o:mgrren:5:111'), 'rename button present');
});

test('manager menu offers an invite button', async () => {
  const store = offlineStorage({
    listClassManagers: async () => [{ userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' }],
  });
  const { managerMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mgr:5:111', '5', '111'] });
  await managerMenu(ctx);
  const cbs = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cbs.includes('o:mgrinv:5:111'), 'invite button present');
});

test('inviteManager: replies with a forwardable deep-link invitation', async () => {
  const store = offlineStorage({
    listClassManagers: async () => [{ userId: '111', role: 'assistant', displayName: 'سارة', addedBy: '999' }],
  });
  const { inviteManager } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mgrinv:5:111', '5', '111'] });
  await inviteManager(ctx);
  assert.equal(calls.reply.length, 1);
  const text = calls.reply[0][0];
  assert.match(text, /https:\/\/t\.me\/DeenCirclesBot\?start=offline/);
  assert.match(text, /صف الفجر/); // class name is included
  assert.match(text, /مساعِدة/); // her role label
});

test('inviteManager: operator can invite an assistant but not another operator', async () => {
  const store = withRole('operator', {
    listClassManagers: async () => [
      { userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' },
      { userId: '222', role: 'assistant', displayName: 'سارة', addedBy: '999' },
    ],
  });
  const { inviteManager } = handlers(store);
  const ok = makeCtx({ userId: DELEGATE, match: ['o:mgrinv:5:222', '5', '222'] });
  await inviteManager(ok.ctx);
  assert.equal(ok.calls.reply.length, 1);

  const denied = makeCtx({ userId: DELEGATE, match: ['o:mgrinv:5:111', '5', '111'] });
  await inviteManager(denied.ctx);
  assert.deepEqual(denied.calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(denied.calls.reply.length, 0);
});

test('removeManager: removes the delegate and refreshes the list', async () => {
  let removed = null;
  const store = offlineStorage({
    removeClassManager: async (gref, uid) => { removed = { gref, uid }; return { ok: true }; },
    listClassManagers: async () => [{ userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' }],
  });
  const { removeManager } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:mgrrmx:5:111', '5', '111'] });
  await removeManager(ctx);
  assert.deepEqual(removed, { gref: 5, uid: '111' });
  assert.equal(calls.editMessageText.length, 1);
});

test('addManagerRoleMenu: operator skips the role picker and prompts for an assistant', async () => {
  let record = null;
  const store = withRole('operator', { setReplyPrompt: async (_c, _m, rec) => { record = rec; } });
  const { addManagerRoleMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:mgradd:5', '5'] });
  await addManagerRoleMenu(ctx);
  // No role-picker menu was shown; instead a force-reply prompt was opened.
  assert.equal(calls.editMessageText.length, 0);
  assert.equal(record.action, 'offlineAddManager');
  assert.equal(record.role, 'assistant');
});

test('addManagerPrompt: forces the assistant role for a non-owner operator', async () => {
  let record = null;
  const store = withRole('operator', { setReplyPrompt: async (_c, _m, rec) => { record = rec; } });
  const { addManagerPrompt } = handlers(store);
  const { ctx } = makeCtx({ userId: DELEGATE, match: ['o:mgrrole:5:operator', '5', 'operator'] });
  await addManagerPrompt(ctx);
  assert.equal(record.role, 'assistant'); // operator cannot create another operator
});

test('managerMenu: operator does not see the role-toggle (promote) button', async () => {
  const store = withRole('operator', {
    listClassManagers: async () => [{ userId: '222', role: 'assistant', displayName: 'سارة', addedBy: '999' }],
  });
  const { managerMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:mgr:5:222', '5', '222'] });
  await managerMenu(ctx);
  const cbs = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(!cbs.some((d) => /^o:mgrset:/.test(d)), 'no role change for operators');
  assert.ok(cbs.includes('o:mgrren:5:222'), 'can still rename the assistant');
  assert.ok(cbs.includes('o:mgrrm:5:222'), 'can still remove the assistant');
});

test('managerMenu: operator cannot open another operator', async () => {
  const store = withRole('operator', {
    listClassManagers: async () => [{ userId: '111', role: 'operator', displayName: 'هدى', addedBy: '999' }],
  });
  const { managerMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:mgr:5:111', '5', '111'] });
  await managerMenu(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
});

test('cloneClass: operator copies a shared class into her own', async () => {
  let cloned = null;
  const store = withRole('operator', {
    cloneOfflineClass: async (rowId, ownerUserId) => {
      cloned = { rowId, ownerUserId };
      return { ok: true, rowId: 77, groupId: 'offline:111:new', name: 'صف الفجر (نسخة)', students: 2, teachers: 1 };
    },
  });
  const { cloneClass } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:clone:5', '5'] });
  await cloneClass(ctx);
  assert.deepEqual(cloned, { rowId: 5, ownerUserId: DELEGATE });
  assert.equal(calls.editMessageText.length, 1);
  // Navigates to the newly owned class home (owner buttons for row 77).
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:crename:77'));
});

test('cloneClass: owner is denied (nothing to clone)', async () => {
  const { cloneClass } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:clone:5', '5'] });
  await cloneClass(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
});

test('cloneClass: assistant is denied', async () => {
  const { cloneClass } = handlers(withRole('assistant'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:clone:5', '5'] });
  await cloneClass(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
});

test('entry: shows the mine/shared chooser when the user owns and is shared classes', async () => {
  const store = offlineStorage({
    listSharedClasses: async () => [{ groupId: 'offline:888:x', name: 'صف الضحى', rowId: 9, role: 'operator' }],
  });
  const { entry } = handlers(store);
  const { ctx, calls } = makeCtx({ chatType: 'private', userId: OWNER, text: '/offline' });
  await entry(ctx);
  const data = calls.reply[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:mine'));
  assert.ok(data.includes('o:shared'));
});

test('sharedClasses: lists classes shared with the delegate', async () => {
  const store = offlineStorage({
    listSharedClasses: async () => [{ groupId: 'offline:888:x', name: 'صف الضحى', rowId: 9, role: 'assistant' }],
  });
  const { sharedClasses } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:shared'] });
  await sharedClasses(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard;
  const data = kb.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:cls:9'));
  assert.ok(!data.includes('o:new')); // delegates cannot create classes
});

// ── Training groups (offline) ─────────────────────────────────────────

const SAMPLE_TG = [
  { id: 'tg-a', name: 'تدريب أ' },
  { id: 'tg-b', name: 'تدريب ب' },
];

test('classHome: owner sees a training-groups button', async () => {
  const { classHome } = handlers(offlineStorage());
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:tgs:5'), 'has training-groups button');
});

test('trainingGroups: lists groups with add, back and close rows', async () => {
  const store = offlineStorage({ getOfflineTrainingGroups: async () => SAMPLE_TG });
  const { trainingGroups } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tgs:5', '5'] });
  await trainingGroups(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:tgadd:5'), 'has add button');
  assert.ok(data.includes('o:tg:5:tg-a'), 'first group tappable');
  assert.ok(data.includes('o:tg:5:tg-b'), 'second group tappable');
  assert.ok(data.includes('o:cls:5'), 'has back-to-class row');
});

test('trainingGroupMenu: opens rename/remove for a group', async () => {
  const store = offlineStorage({ getOfflineTrainingGroups: async () => SAMPLE_TG });
  const { trainingGroupMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tg:5:tg-a', '5', 'tg-a'] });
  await trainingGroupMenu(ctx);
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:tgstu:5:tg-a'));
  assert.ok(data.includes('o:tgren:5:tg-a'));
  assert.ok(data.includes('o:tgrm:5:tg-a'));
  assert.ok(data.includes('o:tgs:5'), 'back to the list');
});

test('trainingGroupStudentsView: lists the students assigned to the group', async () => {
  const store = offlineStorage({
    getOfflineTrainingGroups: async () => SAMPLE_TG,
    getMaster: async () => ({ members: [
      { userId: 'offline:u1', name: 'مريم', listNumber: 1, trainingGroupId: 'tg-a' },
      { userId: 'offline:u2', name: 'خديجة', listNumber: 2, trainingGroupId: 'tg-b' },
      { userId: 'offline:u3', name: 'سارة', listNumber: 3, trainingGroupId: 'tg-a' },
    ] }),
  });
  const { trainingGroupStudentsView } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tgstu:5:tg-a', '5', 'tg-a'] });
  await trainingGroupStudentsView(ctx);
  const body = calls.editMessageText[0][0];
  assert.match(body, /مريم/);
  assert.match(body, /سارة/);
  assert.ok(!body.includes('خديجة'), 'excludes students of other groups');
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:tg:5:tg-a'), 'back to the group menu');
});

test('removeTrainingGroup: deletes and refreshes the list', async () => {
  let removedWith = null;
  const store = offlineStorage({
    removeOfflineTrainingGroup: async (gid, id) => { removedWith = { gid, id }; return { ok: true, name: 'تدريب أ' }; },
    getOfflineTrainingGroups: async () => [{ id: 'tg-b', name: 'تدريب ب' }],
  });
  const { removeTrainingGroup } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tgrmx:5:tg-a', '5', 'tg-a'] });
  await removeTrainingGroup(ctx);
  assert.deepEqual(removedWith, { gid: 'offline:999:abc', id: 'tg-a' });
  const data = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(!data.includes('o:tg:5:tg-a'), 'removed group is gone');
  assert.ok(data.includes('o:tg:5:tg-b'), 'remaining group stays');
});

test('addTrainingGroupPrompt: opens a force-reply awaiting an add', async () => {
  const prompts = [];
  const store = offlineStorage({ setReplyPrompt: async (_c, _m, record) => { prompts.push(record); } });
  const { addTrainingGroupPrompt } = handlers(store);
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:tgadd:5', '5'] });
  await addTrainingGroupPrompt(ctx);
  assert.equal(prompts[0].action, 'offlineAddTrainingGroup');
  assert.equal(prompts[0].gref, 5);
});

test('studentMenu: shows the training-assign button with the current group', async () => {
  const store = offlineStorage({
    getOfflineTrainingGroups: async () => SAMPLE_TG,
    getMaster: async () => ({ members: [{ userId: 'offline:u1', name: 'مريم', listNumber: 1, trainingGroupId: 'tg-a' }] }),
  });
  const { studentMenu } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:stu:5:1:0', '5', '1', '0'] });
  await studentMenu(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat();
  const assignBtn = kb.find((b) => b.callback_data === 'o:sassign:5:1:0');
  assert.ok(assignBtn, 'has an assign button');
  assert.match(assignBtn.text, /تدريب أ/, 'shows the current training group name');
});

test('studentTrainingPicker: lists groups, marks current, offers unassign', async () => {
  const store = offlineStorage({
    getOfflineTrainingGroups: async () => SAMPLE_TG,
    getMaster: async () => ({ members: [{ userId: 'offline:u1', name: 'مريم', listNumber: 1, trainingGroupId: 'tg-a' }] }),
  });
  const { studentTrainingPicker } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sassign:5:1:0', '5', '1', '0'] });
  await studentTrainingPicker(ctx);
  const kb = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat();
  const data = kb.map((b) => b.callback_data);
  assert.ok(data.includes('o:sasx:5:1:0:tg-a'));
  assert.ok(data.includes('o:sasx:5:1:0:tg-b'));
  assert.ok(data.includes('o:sunx:5:1:0'), 'offers unassign since she is assigned');
  const marked = kb.find((b) => b.callback_data === 'o:sasx:5:1:0:tg-a');
  assert.match(marked.text, /✅/, 'current group is marked');
});

test('studentTrainingPicker: alerts when there are no training groups', async () => {
  const store = offlineStorage({ getOfflineTrainingGroups: async () => [] });
  const { studentTrainingPicker } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sassign:5:1:0', '5', '1', '0'] });
  await studentTrainingPicker(ctx);
  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.offline.noTrainingGroupsToAssign);
});

test('assignStudentTraining: assigns the picked group and returns to the menu', async () => {
  let assignedWith = null;
  const store = offlineStorage({
    getOfflineTrainingGroups: async () => SAMPLE_TG,
    setOfflineStudentTrainingGroup: async (gid, ln, id) => { assignedWith = { gid, ln, id }; return { ok: true, name: 'مريم' }; },
  });
  const { assignStudentTraining } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sasx:5:1:0:tg-b', '5', '1', '0', 'tg-b'] });
  await assignStudentTraining(ctx);
  assert.deepEqual(assignedWith, { gid: 'offline:999:abc', ln: '1', id: 'tg-b' });
  assert.equal(calls.editMessageText.length, 1);
});

test('unassignStudentTraining: clears the assignment', async () => {
  let clearedWith = null;
  const store = offlineStorage({
    getOfflineTrainingGroups: async () => SAMPLE_TG,
    setOfflineStudentTrainingGroup: async (gid, ln, id) => { clearedWith = { gid, ln, id }; return { ok: true, name: 'مريم' }; },
  });
  const { unassignStudentTraining } = handlers(store);
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:sunx:5:1:0', '5', '1', '0'] });
  await unassignStudentTraining(ctx);
  assert.deepEqual(clearedWith, { gid: 'offline:999:abc', ln: '1', id: null });
  assert.equal(calls.editMessageText.length, 1);
  assert.equal(calls.answerCbQuery[0][0], TEXT.offline.studentTrainingUnassigned);
});
