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

test('classHome: operator hides rename + managers, keeps operational buttons', async () => {
  const { classHome } = handlers(withRole('operator'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:cls:5', '5'] });
  await classHome(ctx);
  const data = classHomeData(calls);
  assert.ok(!data.includes('o:crename:5'));
  assert.ok(!data.includes('o:mgrs:5'));
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

test('managersMenu: operator (non-owner) is denied', async () => {
  const { managersMenu } = handlers(withRole('operator'));
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:mgrs:5', '5'] });
  await managersMenu(ctx);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(calls.editMessageText.length, 0);
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
