import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/homework.js';
import { makeCtx, makeTelegram, makeStorage } from './mocks.js';
import { TEXT } from '../lib/text.js';

const HW = TEXT.homework;
const OWNER = 1001;
const STUDENT = 2002;

// ── Helpers ──────────────────────────────────────────────────────────────────

// A Telegram client that records setMessageReaction + sendMessage calls.
function telegramRec(overrides = {}) {
  const reactions = [];
  const telegram = makeTelegram({
    setMessageReaction: (...a) => { reactions.push(a); return Promise.resolve(true); },
    ...overrides,
  });
  return { telegram, reactions };
}

// A hand-built context for an incoming message (makeCtx models callback queries).
function msgCtx({ chatType = 'supergroup', chatId = -100, userId = OWNER, text, caption, replyToId = null, messageId = 900 } = {}) {
  const calls = { reply: [], next: 0 };
  const message = { message_id: messageId };
  if (text !== undefined) message.text = text;
  if (caption !== undefined) message.caption = caption;
  if (replyToId !== null) message.reply_to_message = { message_id: replyToId };
  const ctx = {
    chat: { id: chatId, type: chatType },
    from: { id: userId, first_name: 'T' },
    message,
    telegram: makeTelegram(),
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: messageId + 1, chat: { id: chatId } }); },
  };
  const next = () => { calls.next += 1; return Promise.resolve(); };
  return { ctx, calls, next };
}

function listenerStorage(overrides = {}) {
  return makeStorage({
    resolveHomeworkMainGroup: async () => ({ mainGroupId: '555', mainRowId: 5 }),
    getHomeworkBySourceMessage: async () => null,
    findMemberByUserId: async () => ({ id: 7, name: 'فاطمة' }),
    recordSubmission: async () => 1,
    markReviewedByMessage: async () => true,
    addHomework: async () => 10,
    getTeachers: async () => [],
    getHomework: async () => [],
    ...overrides,
  });
}

function editData(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

function editText(calls) {
  return calls.editMessageText[0][0];
}

// ── Group listener: assignment posts ─────────────────────────────────────────

test('listener: a #التكليف post by staff registers a homework item and reacts 📓', async () => {
  const added = [];
  const storage = listenerStorage({ addHomework: async (g, hw) => { added.push([g, hw]); return 10; } });
  const { telegram, reactions } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, next } = msgCtx({ text: 'حل تمارين الدرس الأول #التكليف', messageId: 900 });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(added.length, 1);
  assert.equal(added[0][0], '555');
  assert.equal(added[0][1].sourceMessageId, 900);
  assert.match(added[0][1].title, /حل تمارين الدرس الأول/);
  assert.equal(reactions[0][2][0].emoji, '📓');
});

test('listener: a #التكليف post from a non-staff member is ignored', async () => {
  let added = 0;
  const storage = listenerStorage({ addHomework: async () => { added += 1; return 10; }, getTeachers: async () => [] });
  const { telegram } = telegramRec({ getChatMember: async () => ({ status: 'member' }) });
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ text: 'تكليف مزيّف #التكليف', userId: STUDENT });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(added, 0);
  assert.equal(calls.next, 1);
});

test('listener: a homeworkteacher (non-admin) may post assignments', async () => {
  const added = [];
  const storage = listenerStorage({
    addHomework: async (g, hw) => { added.push([g, hw]); return 10; },
    getTeachers: async () => [{ id: 1, userId: String(STUDENT), name: 'أستاذة', type: 'homeworkteacher' }],
  });
  const { telegram } = telegramRec({ getChatMember: async () => ({ status: 'member' }) });
  const h = createHandlers({ storage, telegram });
  const { ctx, next } = msgCtx({ text: 'الدرس #التكليف', userId: STUDENT });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(added.length, 1);
});

// ── Group listener: submissions ──────────────────────────────────────────────

test('listener: a registered member replying to an assignment records a submission and reacts 👍', async () => {
  const subs = [];
  const storage = listenerStorage({
    getHomeworkBySourceMessage: async () => ({ id: 10, title: 'الدرس', sourceMessageId: 900, postedBy: null, createdAt: null }),
    findMemberByUserId: async () => ({ id: 7, name: 'فاطمة' }),
    recordSubmission: async (...a) => { subs.push(a); return 1; },
  });
  const { telegram, reactions } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, next } = msgCtx({ text: 'تم الحل بحمد الله', replyToId: 900, userId: STUDENT, messageId: 901 });

  await h.onHomeworkMessage(ctx, next);

  assert.deepEqual(subs[0], [10, 7, 901]);
  assert.equal(reactions[0][2][0].emoji, '👍');
});

test('listener: an unregistered replier to an assignment is passed through', async () => {
  let recorded = 0;
  const storage = listenerStorage({
    getHomeworkBySourceMessage: async () => ({ id: 10, title: 'الدرس', sourceMessageId: 900, postedBy: null, createdAt: null }),
    findMemberByUserId: async () => null,
    recordSubmission: async () => { recorded += 1; return 1; },
  });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ text: 'أنا زائرة', replyToId: 900, userId: 4004 });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(recorded, 0);
  assert.equal(calls.next, 1);
});

// ── Group listener: reviews ──────────────────────────────────────────────────

test('listener: staff replying to a submission marks it reviewed and reacts ✅', async () => {
  const reviews = [];
  const storage = listenerStorage({
    getHomeworkBySourceMessage: async () => null, // reply target is a submission, not an assignment
    markReviewedByMessage: async (...a) => { reviews.push(a); return true; },
  });
  const { telegram, reactions } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, next } = msgCtx({ text: 'أحسنتِ، بارك الله فيكِ', replyToId: 555, userId: OWNER });

  await h.onHomeworkMessage(ctx, next);

  assert.deepEqual(reviews[0], [555, OWNER]);
  assert.equal(reactions[0][2][0].emoji, '✅');
});

test('listener: a non-staff reply never flips a submission to reviewed', async () => {
  let reviewed = 0;
  const storage = listenerStorage({
    getHomeworkBySourceMessage: async () => null,
    getTeachers: async () => [],
    markReviewedByMessage: async () => { reviewed += 1; return true; },
  });
  const { telegram } = telegramRec({ getChatMember: async () => ({ status: 'member' }) });
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ text: 'ما شاء الله', replyToId: 555, userId: STUDENT });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(reviewed, 0);
  assert.equal(calls.next, 1);
});

// ── Group listener: pass-through guards ──────────────────────────────────────

test('listener: messages outside a homework group are passed through', async () => {
  let added = 0;
  const storage = listenerStorage({ resolveHomeworkMainGroup: async () => null, addHomework: async () => { added += 1; return 1; } });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ text: 'الدرس #التكليف' });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(added, 0);
  assert.equal(calls.next, 1);
});

test('listener: ordinary chatter (no reply, no tag) never hits the database', async () => {
  let resolved = 0;
  const storage = listenerStorage({ resolveHomeworkMainGroup: async () => { resolved += 1; return { mainGroupId: '555', mainRowId: 5 }; } });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ text: 'صباح الخير جميعاً' });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(resolved, 0);
  assert.equal(calls.next, 1);
});

// ── Group /manage panel (mg:hw*) ─────────────────────────────────────────────

function panelStorage(overrides = {}) {
  return makeStorage({
    getHomework: async () => [{ id: 1, title: 'الدرس الأول', sourceMessageId: 900, postedBy: null, createdAt: null }],
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس الأول', sourceMessageId: 900, postedBy: null, createdAt: null }),
    getMaster: async () => ({ members: [{ userId: '1', name: 'فاطمة' }, { userId: '2', name: 'عائشة' }] }),
    getSubmissions: async () => [{ id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: 901, submittedAt: null, reviewed: false, reviewedBy: null, reviewedAt: null }],
    getHomeworkGroupId: async () => '-999',
    removeHomework: async () => {},
    ...overrides,
  });
}

test('group panel: admin sees the homework list with item + back rows', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hw:-100', '-100'] });
  const h = createHandlers({ storage: panelStorage(), telegram });

  await h.homeworkGroup(ctx);

  const data = editData(calls);
  assert.ok(data.includes('mg:hwit:-100:1'));
  assert.ok(data.includes('mg:home:-100'));
});

test('group panel: item detail shows counts, breakdown, tag + remove buttons', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hwit:-100:1', '-100', '1'] });
  const h = createHandlers({ storage: panelStorage(), telegram });

  await h.homeworkItemGroup(ctx);

  const data = editData(calls);
  assert.ok(data.includes('mg:hwtag:-100:1'));
  assert.ok(data.includes('mg:hwrm:-100:1'));
  assert.ok(data.includes('mg:hw:-100'));
  const text = editText(calls);
  assert.ok(text.includes('فاطمة'));
  assert.ok(text.includes('عائشة'));
});

test('group panel: tagging non-submitters mentions them in the homework group', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hwtag:-100:1', '-100', '1'] });
  const h = createHandlers({ storage: panelStorage(), telegram });

  await h.homeworkTagGroup(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], '-999');
  assert.ok(telegram.calls.sendMessage[0][1].includes('tg://user?id=2')); // عائشة, who hasn't submitted
  assert.equal(calls.answerCbQuery[0][0], HW.tagDoneToast(1));
});

test('group panel: tagging when everyone submitted answers a friendly toast', async () => {
  const storage = panelStorage({
    getSubmissions: async () => [
      { id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: 901, submittedAt: null, reviewed: false, reviewedBy: null, reviewedAt: null },
      { id: 2, memberId: 8, memberName: 'عائشة', submissionMessageId: 902, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null },
    ],
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hwtag:-100:1', '-100', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkTagGroup(ctx);

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.equal(calls.answerCbQuery[0][0], HW.allTagged);
});

test('group panel: confirming removal deletes and re-renders the list', async () => {
  const removed = [];
  const storage = panelStorage({ removeHomework: async (g, id) => { removed.push([g, id]); }, getHomework: async () => [] });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hwrmx:-100:1', '-100', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkRemoveExecGroup(ctx);

  assert.deepEqual(removed, [['-100', '1']]);
  assert.ok(editData(calls).includes('mg:home:-100'));
});

test('group panel: a non-admin is rejected', async () => {
  const telegram = makeTelegram();
  telegram.getChatMember = () => Promise.resolve({ status: 'member' });
  const { ctx, calls } = makeCtx({ chatType: 'group', chatId: -100, match: ['mg:hw:-100', '-100'] });
  const h = createHandlers({ storage: panelStorage(), telegram });

  await h.homeworkGroup(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

// ── Offline class panel (o:hw*) ──────────────────────────────────────────────

function offlineStorage(overrides = {}) {
  return makeStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'owner', name: 'صف' }),
    getHomework: async () => [{ id: 1, title: 'الدرس الأول', content: null, sourceMessageId: null, postedBy: null, createdAt: null, files: [], fileCount: 0 }],
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس الأول', content: null, sourceMessageId: null, postedBy: null, createdAt: null, files: [], fileCount: 0 }),
    getMembersWithIds: async () => [{ id: 7, name: 'فاطمة', userId: null, listNumber: 1 }, { id: 8, name: 'عائشة', userId: null, listNumber: 2 }],
    getSubmissions: async () => [],
    addHomework: async () => 2,
    removeHomework: async () => {},
    addHomeworkFile: async () => 11,
    setHomeworkContent: async () => {},
    setSubmissionState: async () => true,
    getSubmissionForMember: async () => null,
    setTeacherReply: async () => true,
    ...overrides,
  });
}

test('offline panel: owner sees the list with an add button', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hw:5', '5'] });
  const h = createHandlers({ storage: offlineStorage(), telegram });

  await h.homeworkOffline(ctx);

  const data = editData(calls);
  assert.ok(data.includes('o:hwadd:5'));
  assert.ok(data.includes('o:hwit:5:1'));
  assert.ok(data.includes('o:cls:5'));
});

test('offline panel: assistant is rejected (homework is owner/operator only)', async () => {
  const storage = offlineStorage({ resolveManageableClass: async () => ({ groupId: 'offline:o:1', rowId: 5, role: 'assistant', name: 'صف' }) });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: STUDENT, match: ['o:hw:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkOffline(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

test('offline panel: add prompt stores a homeworkAddOffline reply prompt', async () => {
  const prompts = [];
  const storage = offlineStorage({ setReplyPrompt: async (chatId, msgId, rec) => { prompts.push(rec); } });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwadd:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkAddOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'homeworkAddOffline');
  assert.equal(prompts[0].surface, 'offline');
  assert.equal(prompts[0].gref, '5');
  assert.equal(prompts[0].groupId, 'offline:o:1');
});

test('offline panel: item detail lists a toggle button per student', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwit:5:1', '5', '1'] });
  const h = createHandlers({ storage: offlineStorage(), telegram });

  await h.homeworkItemOffline(ctx);

  const data = editData(calls);
  assert.ok(data.includes('o:hwtog:5:1:7'));
  assert.ok(data.includes('o:hwtog:5:1:8'));
  assert.ok(data.includes('o:hwrm:5:1'));
  assert.ok(data.includes('o:hw:5'));
});

// ── Offline homework content (text body + attached media) ────────────────────

test('offline panel: item detail exposes content buttons (set text + attach)', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwit:5:1', '5', '1'] });
  const h = createHandlers({ storage: offlineStorage(), telegram });

  await h.homeworkItemOffline(ctx);

  const data = editData(calls);
  assert.ok(data.includes('o:hwtext:5:1'));
  assert.ok(data.includes('o:hwatt:5:1'));
  // No content yet → no "send content to me" button.
  assert.ok(!data.includes('o:hwview:5:1'));
});

test('offline panel: item with content shows the view-content button', async () => {
  const storage = offlineStorage({
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس', content: 'اقرئي الصفحة', sourceMessageId: null, postedBy: null, createdAt: null, files: [{ id: 11, fileId: 'F1', fileType: 'photo', fileName: null, position: 1 }], fileCount: 1 }),
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwit:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkItemOffline(ctx);

  assert.ok(editData(calls).includes('o:hwview:5:1'));
});

test('offline panel: set-text stores a homeworkContentText reply prompt', async () => {
  const prompts = [];
  const storage = offlineStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtext:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkSetTextOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'homeworkContentText');
  assert.equal(prompts[0].itemId, 1);
  assert.equal(prompts[0].gref, '5');
});

test('offline panel: attach opens an upload session (prompt + session view)', async () => {
  const prompts = [];
  const storage = offlineStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwatt:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkAttachOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'homeworkContentUpload');
  assert.equal(prompts[0].itemId, 1);
  // Panel switched to the session view with a Done button.
  assert.ok(editData(calls).some((cb) => cb.startsWith('o:hwattdone:5:1:')));
});

test('offline panel: view-content sends the text + media to the manager', async () => {
  const storage = offlineStorage({
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس', content: 'اقرئي الصفحة', sourceMessageId: null, postedBy: null, createdAt: null, files: [{ id: 11, fileId: 'F1', fileType: 'photo', fileName: null, position: 1 }], fileCount: 1 }),
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwview:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkViewContentOffline(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1); // text body
  assert.equal(telegram.calls.sendPhoto.length, 1);   // one attachment
  assert.equal(calls.answerCbQuery[0][0], HW.contentSentToast);
});

test('offline panel: view-content with no content answers a friendly toast', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwview:5:1', '5', '1'] });
  const h = createHandlers({ storage: offlineStorage(), telegram });

  await h.homeworkViewContentOffline(ctx);

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.equal(calls.answerCbQuery[0][0], HW.noContent);
});

// ── Teacher-side student submissions inbox + reply ───────────────────────────

const dmSub = (over = {}) => ({
  id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null,
  content: 'أنجزت الواجب', fileId: null, fileType: null, teacherReply: null, teacherReplyAt: null,
  submittedAt: null, reviewed: false, reviewedBy: null, reviewedAt: null, resubmitted: false, resubmittedAt: null,
  ...over,
});

test('offline panel: item detail shows a submissions button when a student submitted via DM', async () => {
  const storage = offlineStorage({ getSubmissions: async () => [dmSub()] });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwit:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkItemOffline(ctx);

  assert.ok(editData(calls).includes('o:hwsubs:5:1'));
});

test('offline submissions inbox: lists members who submitted content', async () => {
  const storage = offlineStorage({ getSubmissions: async () => [dmSub()] });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwsubs:5:1', '5', '1'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkSubmissionsOffline(ctx);

  assert.ok(editData(calls).includes('o:hwsub:5:1:7'));
});

test('offline submission detail: pushes media and offers a reply button', async () => {
  const storage = offlineStorage({
    getSubmissionForMember: async () => dmSub({ fileId: 'PIC', fileType: 'photo' }),
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwsub:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkSubmissionDetailOffline(ctx);

  assert.equal(telegram.calls.sendPhoto.length, 1);
  assert.ok(editData(calls).includes('o:hwreply:5:1:7'));
  assert.match(calls.editMessageText[0][0], /أنجزت الواجب/);
});

test('offline reply: stores a homeworkReply prompt', async () => {
  const prompts = [];
  const storage = offlineStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwreply:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkReplyOffline(ctx);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'homeworkReply');
  assert.equal(prompts[0].itemId, 1);
  assert.equal(prompts[0].memberId, 7);
});

test('listener: a homeworkReply reply stores feedback and DMs the student', async () => {
  const replies = [];
  const storage = offlineStorage({
    getReplyPrompt: async () => ({ action: 'homeworkReply', surface: 'offline', groupId: 'offline:o:1', gref: '5', itemId: 1, memberId: 7, chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => {},
    setTeacherReply: async (...a) => { replies.push(a); return true; },
    getMembersWithIds: async () => [{ id: 7, name: 'فاطمة', userId: '2002', listNumber: 1 }],
    getSubmissionForMember: async () => dmSub({ reviewed: true, teacherReply: 'أحسنتِ' }),
  });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx } = msgCtx({ chatType: 'private', chatId: 777, userId: OWNER, text: 'أحسنتِ', replyToId: 600 });

  let nextCalled = false;
  await h.onHomeworkMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(replies.length, 1);
  assert.equal(replies[0][0], 1); // homework id
  assert.equal(replies[0][1], 7); // member id
  assert.equal(replies[0][2], 'أحسنتِ');
  // Student (user 2002) notified.
  assert.equal(telegram.calls.sendMessage.filter((m) => m[0] === '2002').length, 1);
});

test('offline panel: toggling an unsubmitted student records a submission (⬜️ → 📝)', async () => {
  const calls = [];
  const storage = offlineStorage({ getSubmissions: async () => [], setSubmissionState: async (...a) => { calls.push(a); return true; } });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1);
  assert.equal(calls[0][1], 7);
  assert.equal(calls[0][2], 'submitted');
});

test('offline panel: toggling a submitted student marks it reviewed (📝 → ✅)', async () => {
  const calls = [];
  const storage = offlineStorage({
    getSubmissions: async () => [{ id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null, submittedAt: null, reviewed: false, reviewedBy: null, reviewedAt: null, resubmitted: false, resubmittedAt: null }],
    setSubmissionState: async (...a) => { calls.push(a); return true; },
  });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 1);
  assert.equal(calls[0][1], 7);
  assert.equal(calls[0][2], 'reviewed');
});

test('offline panel: toggling a reviewed student marks it resubmitted (✅ → 🔁)', async () => {
  const calls = [];
  const storage = offlineStorage({
    getSubmissions: async () => [{ id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null, resubmitted: false, resubmittedAt: null }],
    setSubmissionState: async (...a) => { calls.push(a); return true; },
  });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'resubmitted');
});

test('offline panel: toggling a resubmitted student clears all flags (🔁 → ⬜️)', async () => {
  const calls = [];
  const storage = offlineStorage({
    getSubmissions: async () => [{ id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null, resubmitted: true, resubmittedAt: null }],
    setSubmissionState: async (...a) => { calls.push(a); return true; },
  });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'none');
});

// ── Homework report ──────────────────────────────────────────────────────────

test('offline report: sends a report message per class and answers a toast', async () => {
  const storage = offlineStorage({
    getHomework: async () => [{ id: 1, title: 'الدرس الأول', sourceMessageId: null, postedBy: null, createdAt: null }],
    getMembersWithIds: async () => [{ id: 7, name: 'فاطمة', userId: null, listNumber: 1 }, { id: 8, name: 'عائشة', userId: null, listNumber: 2 }],
    getSubmissions: async () => [
      { id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null, resubmitted: false, resubmittedAt: null },
      { id: 2, memberId: 8, memberName: 'عائشة', submissionMessageId: null, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null, resubmitted: true, resubmittedAt: null },
    ],
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwrep:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkReportOffline(ctx);

  assert.ok(calls.reply.length >= 1);
  const text = calls.reply.map((r) => r[0]).join('\n\n');
  assert.ok(text.includes('صف')); // class name in the report header
  assert.ok(text.includes('فاطمة'));
  assert.ok(text.includes('عائشة'));
  assert.equal(calls.answerCbQuery[0][0], HW.reportGeneratedToast);
});

test('offline report: with no homework answers the empty toast and sends nothing', async () => {
  const storage = offlineStorage({ getHomework: async () => [] });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:hwrep:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkReportOffline(ctx);

  assert.equal(calls.reply.length, 0);
  assert.equal(calls.answerCbQuery[0][0], HW.reportEmpty);
});

test('offline report: assistant is rejected', async () => {
  const storage = offlineStorage({ resolveManageableClass: async () => ({ groupId: 'offline:o:1', rowId: 5, role: 'assistant', name: 'صف' }) });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ userId: STUDENT, match: ['o:hwrep:5', '5'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkReportOffline(ctx);

  assert.equal(calls.reply.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

test('group report: sends a report keyed by member name and answers a toast', async () => {
  const storage = panelStorage({
    getSubmissions: async () => [
      { id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: 901, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null, resubmitted: false, resubmittedAt: null },
    ],
  });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hwrep:-100', '-100'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkReportGroup(ctx);

  assert.ok(calls.reply.length >= 1);
  const text = calls.reply.map((r) => r[0]).join('\n\n');
  assert.ok(text.includes('فاطمة'));
  assert.ok(text.includes('عائشة'));
  assert.equal(calls.answerCbQuery[0][0], HW.reportGeneratedToast);
});

test('group report: with no homework answers the empty toast', async () => {
  const storage = panelStorage({ getHomework: async () => [] });
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true, chatId: -100, match: ['mg:hwrep:-100', '-100'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkReportGroup(ctx);

  assert.equal(calls.reply.length, 0);
  assert.equal(calls.answerCbQuery[0][0], HW.reportEmpty);
});

// ── Offline add-title reply (handled in the message listener) ────────────────

test('listener: an offline add-title reply creates the item and refreshes the panel', async () => {
  const added = [];
  let deleted = false;
  const storage = listenerStorage({
    getReplyPrompt: async () => ({ action: 'homeworkAddOffline', surface: 'offline', groupId: 'offline:o:1', gref: '5', chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => { deleted = true; },
    addHomework: async (g, hw) => { added.push([g, hw]); return 3; },
    getHomework: async () => [{ id: 3, title: 'الدرس الأول', sourceMessageId: null, postedBy: null, createdAt: null }],
  });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx } = msgCtx({ chatType: 'private', chatId: 777, userId: OWNER, text: 'الدرس الأول', replyToId: 600 });

  let nextCalled = false;
  await h.onHomeworkMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(deleted, true);
  assert.equal(added.length, 1);
  assert.equal(added[0][0], 'offline:o:1');
  assert.equal(added[0][1].title, 'الدرس الأول');
  assert.equal(added[0][1].sourceMessageId, null);
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('listener: a content-text reply saves the body and refreshes the item panel', async () => {
  const saved = [];
  let deleted = false;
  const storage = listenerStorage({
    getReplyPrompt: async () => ({ action: 'homeworkContentText', surface: 'offline', groupId: 'offline:o:1', gref: '5', itemId: 3, chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => { deleted = true; },
    setHomeworkContent: async (g, id, body) => { saved.push([g, id, body]); },
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس', content: 'اقرئي الصفحة', sourceMessageId: null, postedBy: null, createdAt: null, files: [], fileCount: 0 }),
    getMembersWithIds: async () => [],
    getSubmissions: async () => [],
  });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx } = msgCtx({ chatType: 'private', chatId: 777, userId: OWNER, text: 'اقرئي الصفحة', replyToId: 600 });

  let nextCalled = false;
  await h.onHomeworkMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(deleted, true);
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0][0], String(saved[0][1]), saved[0][2]], ['offline:o:1', '3', 'اقرئي الصفحة']);
  assert.equal(telegram.calls.editMessageText.length, 1); // panel refreshed
});

test('listener: a content-upload media reply appends a file and keeps the session open', async () => {
  const files = [];
  const armed = [];
  const storage = listenerStorage({
    getReplyPrompt: async () => ({ action: 'homeworkContentUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', itemId: 3, count: 0, chatId: 777, msgId: 600, promptMsgId: 600 }),
    delReplyPrompt: async () => {},
    setReplyPrompt: async (_c, msgId, rec) => { armed.push({ msgId, rec }); },
    addHomeworkFile: async (id, f) => { files.push([id, f]); return 11; },
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس', content: null, sourceMessageId: null, postedBy: null, createdAt: null, files: [{ id: 11, fileId: 'PID', fileType: 'photo', fileName: null, position: 1 }], fileCount: 1 }),
  });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });

  // A photo message replying to the live upload prompt.
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER, first_name: 'T' },
    message: { message_id: 601, reply_to_message: { message_id: 600 }, photo: [{ file_id: 'small' }, { file_id: 'PID' }] },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 610 }); },
  };

  let nextCalled = false;
  await h.onHomeworkMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(files.length, 1);
  assert.equal(files[0][0], 3);                 // homework id
  assert.equal(files[0][1].fileId, 'PID');      // largest photo size
  assert.equal(files[0][1].fileType, 'photo');
  // Session persisted in place (no new force-reply message), same prompt id.
  assert.equal(armed.length, 1);
  assert.equal(armed[0].msgId, 600);
  assert.equal(armed[0].rec.action, 'homeworkContentUpload');
  assert.equal(armed[0].rec.count, 1);
  assert.equal(telegram.calls.editMessageText.length, 1); // session view refreshed
});

test('listener: an album content file without a reply still appends to the session', async () => {
  const files = [];
  const storage = listenerStorage({
    getReplyPrompt: async () => null,
    getActiveReplyPrompt: async () => ({ action: 'homeworkContentUpload', surface: 'offline', groupId: 'offline:o:1', gref: '5', itemId: 3, count: 1, chatId: 777, msgId: 600, promptMsgId: 600 }),
    delReplyPrompt: async () => {},
    setReplyPrompt: async () => {},
    addHomeworkFile: async (id, f) => { files.push([id, f]); return 12; },
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس', content: null, sourceMessageId: null, postedBy: null, createdAt: null, files: [], fileCount: 2 }),
  });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });

  // A photo with NO reply_to (a 2nd album item).
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER, first_name: 'T' },
    message: { message_id: 602, photo: [{ file_id: 'small' }, { file_id: 'PID2' }] },
    telegram,
    reply() { return Promise.resolve({ message_id: 611 }); },
  };

  let nextCalled = false;
  await h.onHomeworkMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(files.length, 1);
  assert.equal(files[0][1].fileId, 'PID2');
});

test('listener: an unrelated private reply is passed through', async () => {
  const storage = listenerStorage({ getReplyPrompt: async () => ({ action: 'add' }) });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ chatType: 'private', chatId: 777, userId: OWNER, text: 'شيء آخر', replyToId: 600 });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(calls.next, 1);
});
