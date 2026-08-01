import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/studentHomework.js';
import { makeCtx, makeTelegram, makeStorage } from './mocks.js';
import { TEXT } from '../lib/text.js';

const SH = TEXT.studentHomework;
const STUDENT = 2002;

function studentStorage(overrides = {}) {
  return makeStorage({
    getReplyPrompt: async () => null,
    delReplyPrompt: async () => {},
    setReplyPrompt: async () => {},
    linkStudentUser: async () => ({ id: 7, name: 'فاطمة', groupId: 'offline:o:1' }),
    listStudentClasses: async () => [{ groupId: 'offline:o:1', rowId: 5, className: 'صف', memberId: 7, memberName: 'فاطمة' }],
    getHomework: async () => [{ id: 1, title: 'الدرس الأول', content: 'اقرئي الصفحة', files: [], fileCount: 0 }],
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس الأول', content: 'اقرئي الصفحة', files: [], fileCount: 0 }),
    getSubmissionForMember: async () => null,
    submitStudentHomework: async () => ({ id: 9, resubmitted: false }),
    listClassStaffUserIds: async () => ['1001'],
    ...overrides,
  });
}

// A private-chat message context (startLink / onStudentMessage read these).
function dmCtx({ userId = STUDENT, chatId = 777, startPayload, text, replyToId = null, photo, voice, messageId = 800 } = {}) {
  const calls = { reply: [] };
  const message = { message_id: messageId };
  if (text !== undefined) message.text = text;
  if (photo) message.photo = photo;
  if (voice) message.voice = voice;
  if (replyToId !== null) message.reply_to_message = { message_id: replyToId };
  const ctx = {
    chat: { id: chatId, type: 'private' },
    from: { id: userId, first_name: 'ط' },
    message,
    startPayload,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: messageId + 1 }); },
  };
  return { ctx, calls };
}

function editData(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

// ── Deep-link entry ──────────────────────────────────────────────────────────

test('startLink: a valid hw-<gref>-<ln> payload links and shows the homework list', async () => {
  const links = [];
  const storage = studentStorage({ linkStudentUser: async (...a) => { links.push(a); return { id: 7, name: 'فاطمة', groupId: 'offline:o:1' }; } });
  const telegram = makeTelegram();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls } = dmCtx({ startPayload: 'hw-5-3' });

  let nextCalled = false;
  await h.startLink(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(links.length, 1);
  assert.deepEqual([String(links[0][0]), links[0][1], links[0][2]], ['5', 3, STUDENT]);
  // Two replies: the welcome toast then the homework list.
  assert.equal(calls.reply.length, 2);
  assert.equal(calls.reply[0][0], SH.linkedToast('فاطمة'));
  assert.match(calls.reply[1][0], /تكاليف/);
});

test('startLink: a non-homework start payload is passed through', async () => {
  const storage = studentStorage();
  const telegram = makeTelegram();
  const h = createHandlers({ storage, telegram });
  const { ctx } = dmCtx({ startPayload: 'offline' });

  let nextCalled = false;
  await h.startLink(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('startLink: a failed link tells the student to check with her teacher', async () => {
  const storage = studentStorage({ linkStudentUser: async () => null });
  const telegram = makeTelegram();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls } = dmCtx({ startPayload: 'hw-5-3' });

  await h.startLink(ctx, async () => {});

  assert.equal(calls.reply.length, 1);
  assert.equal(calls.reply[0][0], SH.linkFailed);
});

// ── Callback navigation ──────────────────────────────────────────────────────

test('list: renders one row per homework item with a status marker', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'private', userId: STUDENT, match: ['sh:list:5', '5'] });
  const h = createHandlers({ storage: studentStorage(), telegram });

  await h.listOffline(ctx);

  assert.ok(editData(calls).includes('sh:it:5:1'));
});

test('item: shows a submit button when nothing has been submitted', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'private', userId: STUDENT, match: ['sh:it:5:1', '5', '1'] });
  const h = createHandlers({ storage: studentStorage(), telegram });

  await h.itemOffline(ctx);

  const data = editData(calls);
  assert.ok(data.includes('sh:sub:5:1'));
  assert.ok(data.includes('sh:view:5:1')); // content available
  assert.ok(data.includes('sh:list:5'));   // back
});

test('item: after review shows the teacher reply and a resubmit button', async () => {
  const storage = studentStorage({
    getSubmissionForMember: async () => ({ reviewed: true, resubmitted: false, teacherReply: 'أحسنتِ، صحّحي السطر الأخير' }),
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'private', userId: STUDENT, match: ['sh:it:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.itemOffline(ctx);

  assert.match(calls.editMessageText[0][0], /صحّحي السطر الأخير/);
  assert.ok(editData(calls).includes('sh:sub:5:1')); // resubmit still routes here
});

test('view content: sends the assignment text to the student', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'private', userId: STUDENT, match: ['sh:view:5:1', '5', '1'] });
  const h = createHandlers({ storage: studentStorage(), telegram });

  await h.viewContentOffline(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(calls.answerCbQuery[0][0], SH.contentSentToast);
});

test('submit prompt: stores a studentSubmit reply prompt', async () => {
  const prompts = [];
  const storage = studentStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ chatType: 'private', userId: STUDENT, match: ['sh:sub:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.submitPrompt(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'studentSubmit');
  assert.equal(prompts[0].itemId, 1);
  assert.equal(prompts[0].memberId, 7);
});

// ── Submission capture ───────────────────────────────────────────────────────

test('submit: a text reply is stored and the class staff are notified', async () => {
  const submits = [];
  const storage = studentStorage({
    getReplyPrompt: async () => ({ action: 'studentSubmit', groupId: 'offline:o:1', gref: '5', itemId: 1, memberId: 7, chatId: 777, msgId: 800 }),
    submitStudentHomework: async (...a) => { submits.push(a); return { id: 9, resubmitted: false }; },
  });
  const telegram = makeTelegram();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls } = dmCtx({ text: 'أنجزت الواجب', replyToId: 800 });

  let nextCalled = false;
  await h.onStudentMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(submits.length, 1);
  assert.equal(submits[0][0], 1);            // homework id
  assert.equal(submits[0][1], 7);            // member id
  assert.equal(submits[0][2].content, 'أنجزت الواجب');
  assert.equal(calls.reply[0][0], SH.submitted);
  // Owner/operator (user 1001) notified.
  assert.equal(telegram.calls.sendMessage.filter((m) => m[0] === '1001').length, 1);
});

test('submit: a photo reply captures the file id and reports resubmission', async () => {
  const submits = [];
  const storage = studentStorage({
    getReplyPrompt: async () => ({ action: 'studentSubmit', groupId: 'offline:o:1', gref: '5', itemId: 1, memberId: 7, chatId: 777, msgId: 800 }),
    submitStudentHomework: async (...a) => { submits.push(a); return { id: 9, resubmitted: true }; },
  });
  const telegram = makeTelegram();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls } = dmCtx({ photo: [{ file_id: 'small' }, { file_id: 'BIG' }], replyToId: 800 });

  await h.onStudentMessage(ctx, async () => {});

  assert.equal(submits[0][2].fileId, 'BIG');
  assert.equal(submits[0][2].fileType, 'photo');
  assert.equal(calls.reply[0][0], SH.resubmitted);
});

test('submit: an unrelated private reply is passed through', async () => {
  const storage = studentStorage({ getReplyPrompt: async () => ({ action: 'somethingElse' }) });
  const telegram = makeTelegram();
  const h = createHandlers({ storage, telegram });
  const { ctx } = dmCtx({ text: 'مرحبا', replyToId: 800 });

  let nextCalled = false;
  await h.onStudentMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
