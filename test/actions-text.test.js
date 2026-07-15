import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/text.js';
import { archivedSessionKey } from '../lib/historyUtils.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';
import { TEXT } from '../lib/text.js';

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
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
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
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
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

test('onText: materialRename renames the lesson and refreshes the item panel', async () => {
  let renamed = null;
  const pending = {
    action: 'materialRename', groupId: 'offline:o:1', chatId: 777, msgId: 555,
    surface: 'offline', token: '5', materialId: 1, promptMsgId: 556, awaitingPrompt: false,
  };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    renameMaterial: async (_g, id, title) => { renamed = { id, title }; },
    getMaterialById: async (_g, id) => ({
      id: Number(id), title: 'العنوان الجديد', addedBy: null, createdAt: null,
      files: [{ id: 11, fileId: 'FID1', fileType: 'document', fileName: null, position: 1 }], fileCount: 1,
    }),
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'العنوان الجديد' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.ok(renamed, 'renameMaterial was called');
  assert.equal(renamed.id, 1);
  assert.equal(renamed.title, 'العنوان الجديد');
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the item panel');
});

test('onText: materialFileRename renames the file and refreshes the files picker', async () => {
  let renamed = null;
  const pending = {
    action: 'materialFileRename', groupId: 'offline:o:1', chatId: 777, msgId: 555,
    surface: 'offline', token: '5', materialId: 1, fileId: 12, promptMsgId: 556, awaitingPrompt: false,
  };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    renameMaterialFile: async (_g, mid, fid, name) => { renamed = { mid, fid, name }; },
    getMaterialById: async (_g, id) => ({
      id: Number(id), title: 'مادة أولى', addedBy: null, createdAt: null,
      files: [
        { id: 11, fileId: 'FID1', fileType: 'document', fileName: 'أول.pdf', position: 1 },
        { id: 12, fileId: 'FID2', fileType: 'photo', fileName: 'الوجه', position: 2 },
      ],
      fileCount: 2,
    }),
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'الوجه' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.ok(renamed, 'renameMaterialFile was called');
  assert.equal(renamed.mid, 1);
  assert.equal(renamed.fid, 12);
  assert.equal(renamed.name, 'الوجه');
  // Two files remain → refreshes the files picker (not the item menu).
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the files picker');
});

test('onText: groupAddTeacher parses "userId | name | type", saves and refreshes the hub panel', async () => {
  let saved = null;
  const pending = { action: 'groupAddTeacher', groupId: '123', chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    getTeachers: async () => [],
    saveTeachers: async (_g, list) => { saved = list; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: '555123 | أمل محمد | courseteacher' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.deepEqual(saved, [{ userId: '555123', name: 'أمل محمد', types: ['courseteacher'] }]);
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the teachers panel');
});

test('onText: groupAddTeacher (role-first) parses "userId | name" lines with the chosen role', async () => {
  let saved = null;
  const pending = { action: 'groupAddTeacher', groupId: '123', role: 'recitationteacher', chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    getTeachers: async () => [],
    saveTeachers: async (_g, list) => { saved = list; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: '555123 | أمل محمد\n555124 | هدى علي' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.deepEqual(saved, [
    { userId: '555123', name: 'أمل محمد', types: ['recitationteacher'] },
    { userId: '555124', name: 'هدى علي', types: ['recitationteacher'] },
  ]);
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the teachers panel');
});

test('onText: groupRenameTeacher renames by userId and refreshes the teacher menu', async () => {
  let saved = null;
  const pending = { action: 'groupRenameTeacher', groupId: '123', chatId: 42, msgId: 555, teacherUserId: '111', awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    getTeachers: async () => [{ userId: '111', name: 'أمل', types: ['courseteacher'] }],
    saveTeachers: async (_g, list) => { saved = list; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'أمل عبد الله' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.equal(saved[0].name, 'أمل عبد الله');
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the teacher menu');
});

test('onText: groupAddTrainingGroup parses "id | name", links and refreshes the list', async () => {
  let saved = null;
  let parented = null;
  const pending = { action: 'groupAddTrainingGroup', groupId: '123', chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    getTrainingGroups: async () => [],
    saveTrainingGroups: async (_g, list) => { saved = list; },
    setParentGroup: async (child, parent) => { parented = [child, parent]; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: '-1001234567890 | تدريب المجموعة الأولى' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.deepEqual(saved, [{ groupId: '-1001234567890', name: 'تدريب المجموعة الأولى' }]);
  assert.deepEqual(parented, ['-1001234567890', '123']);
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the training-groups panel');
});

test('onText: groupRenameTrainingGroup renames by groupId and refreshes the menu', async () => {
  let saved = null;
  const pending = { action: 'groupRenameTrainingGroup', groupId: '123', chatId: 42, msgId: 555, trainingGroupId: '-1001', awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    getTrainingGroups: async () => [{ groupId: '-1001', name: 'تدريب أ' }],
    saveTrainingGroups: async (_g, list) => { saved = list; },
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'تدريب المجموعة الجديدة' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.equal(saved[0].name, 'تدريب المجموعة الجديدة');
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the training-group menu');
});

test('onText: offlineAddTeacher (role-first) adds each plain name with the chosen role', async () => {
  let received = null;
  const pending = { action: 'offlineAddTeacher', groupId: 'offline:9:x', gref: 5, role: 'recitationteacher', chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    addOfflineTeachers: async (_g, entries) => { received = entries; return { added: entries.length }; },
    getOfflineClassById: async () => ({ rowId: 5, groupId: 'offline:9:x', name: 'صف' }),
    getTeachers: async () => [],
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'منال رجب\nآيه سمير\nنجمه احمد' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.deepEqual(received, [
    { name: 'منال رجب', types: ['recitationteacher'] },
    { name: 'آيه سمير', types: ['recitationteacher'] },
    { name: 'نجمه احمد', types: ['recitationteacher'] },
  ]);
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the teachers panel');
});

test('onText: offlineAddTrainingGroup adds a label and refreshes the panel', async () => {
  let addedName = null;
  const pending = { action: 'offlineAddTrainingGroup', groupId: 'offline:9:x', gref: 5, chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    addOfflineTrainingGroup: async (_g, name) => { addedName = name; return { ok: true, group: { id: 'tg-1', name } }; },
    getOfflineTrainingGroups: async () => [{ id: 'tg-1', name: 'تدريب أ' }],
    getOfflineClassById: async () => ({ rowId: 5, groupId: 'offline:9:x', name: 'صف' }),
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'تدريب أ' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.equal(addedName, 'تدريب أ');
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the training-groups panel');
});

test('onText: offlineAddTrainingGroup reports a duplicate name', async () => {
  const pending = { action: 'offlineAddTrainingGroup', groupId: 'offline:9:x', gref: 5, chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    addOfflineTrainingGroup: async () => ({ ok: false, reason: 'duplicate' }),
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx, calls } = makeCtx({ text: 'تدريب أ' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.equal(telegram.calls.editMessageText.length, 0, 'no refresh on failure');
  assert.equal(calls.reply[0][0], TEXT.offline.trainingGroupDuplicate);
});

test('onText: offlineRenameTrainingGroup renames and refreshes the menu', async () => {
  let renamedWith = null;
  const pending = { action: 'offlineRenameTrainingGroup', groupId: 'offline:9:x', gref: 5, trainingGroupId: 'tg-1', chatId: 42, msgId: 555, awaitingPrompt: false };
  const storage = makeStorage({
    getReplyPrompt: async () => pending,
    delReplyPrompt: async () => {},
    renameOfflineTrainingGroup: async (_g, id, name) => { renamedWith = { id, name }; return { ok: true, name }; },
    getOfflineTrainingGroups: async () => [{ id: 'tg-1', name: 'تدريب الجديد' }],
    getOfflineClassById: async () => ({ rowId: 5, groupId: 'offline:9:x', name: 'صف' }),
  });
  const telegram = makeTelegram();
  const { onText } = createHandlers({ storage, telegram });
  const { ctx } = makeCtx({ text: 'تدريب الجديد' });
  ctx.message.reply_to_message = { message_id: 556 };

  await onText(ctx, async () => {});

  assert.deepEqual(renamedWith, { id: 'tg-1', name: 'تدريب الجديد' });
  assert.equal(telegram.calls.editMessageText.length, 1, 'refreshes the training-group menu');
});

