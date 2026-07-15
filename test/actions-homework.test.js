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
    getHomework: async () => [{ id: 1, title: 'الدرس الأول', sourceMessageId: null, postedBy: null, createdAt: null }],
    getHomeworkById: async (_g, id) => ({ id: Number(id), title: 'الدرس الأول', sourceMessageId: null, postedBy: null, createdAt: null }),
    getMembersWithIds: async () => [{ id: 7, name: 'فاطمة', userId: null, listNumber: 1 }, { id: 8, name: 'عائشة', userId: null, listNumber: 2 }],
    getSubmissions: async () => [],
    addHomework: async () => 2,
    removeHomework: async () => {},
    toggleSubmission: async () => true,
    toggleReviewed: async () => true,
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

test('offline panel: toggling an unsubmitted student records a submission (⬜️ → 📝)', async () => {
  const subs = [];
  const storage = offlineStorage({ getSubmissions: async () => [], toggleSubmission: async (...a) => { subs.push(a); return true; } });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.deepEqual(subs[0], [1, 7]);
});

test('offline panel: toggling a submitted student marks it reviewed (📝 → ✅)', async () => {
  const reviews = [];
  let subToggles = 0;
  const storage = offlineStorage({
    getSubmissions: async () => [{ id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null, submittedAt: null, reviewed: false, reviewedBy: null, reviewedAt: null }],
    toggleReviewed: async (...a) => { reviews.push(a); return true; },
    toggleSubmission: async () => { subToggles += 1; return true; },
  });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0][0], 1);
  assert.equal(reviews[0][1], 7);
  assert.equal(subToggles, 0);
});

test('offline panel: toggling a reviewed student clears both flags (✅ → ⬜️)', async () => {
  let reviewToggles = 0;
  let subToggles = 0;
  const storage = offlineStorage({
    getSubmissions: async () => [{ id: 1, memberId: 7, memberName: 'فاطمة', submissionMessageId: null, submittedAt: null, reviewed: true, reviewedBy: null, reviewedAt: null }],
    toggleReviewed: async () => { reviewToggles += 1; return false; },
    toggleSubmission: async () => { subToggles += 1; return false; },
  });
  const telegram = makeTelegram();
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:hwtog:5:1:7', '5', '1', '7'] });
  const h = createHandlers({ storage, telegram });

  await h.homeworkToggleOffline(ctx);

  assert.equal(reviewToggles, 1);
  assert.equal(subToggles, 1);
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

test('listener: an unrelated private reply is passed through', async () => {
  const storage = listenerStorage({ getReplyPrompt: async () => ({ action: 'add' }) });
  const { telegram } = telegramRec();
  const h = createHandlers({ storage, telegram });
  const { ctx, calls, next } = msgCtx({ chatType: 'private', chatId: 777, userId: OWNER, text: 'شيء آخر', replyToId: 600 });

  await h.onHomeworkMessage(ctx, next);

  assert.equal(calls.next, 1);
});
