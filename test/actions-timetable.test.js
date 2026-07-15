import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/timetable.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';
import { TEXT } from '../lib/text.js';

const TT = TEXT.timetable;
const OWNER = 1001;
const DELEGATE = 2002;

function ttStorage(overrides = {}) {
  return makeStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'owner', name: 'صف' }),
    listScheduleSlots: async () => [],
    getScheduleSlot: async (_g, id) => ({ id: Number(id), sessionType: 'main', dayOfWeek: 0, timeOfDay: '17:30', teacherId: null, teacherName: null, teacherType: null }),
    addScheduleSlot: async () => 9,
    setScheduleSlotTeacher: async () => {},
    updateScheduleSlot: async () => {},
    removeScheduleSlot: async () => {},
    listScheduleForUser: async () => [],
    getTeachers: async () => [],
    getClassTimezone: async () => 'Africa/Cairo',
    setClassTimezone: async () => {},
    getUserPrefs: async () => ({ timezone: null, weekStart: 6 }),
    setUserTimezone: async () => {},
    setUserWeekStart: async () => {},
    ...overrides,
  });
}

const handlers = (store) => createHandlers({ storage: store });

function editData(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

const SLOTS = [
  { id: 1, sessionType: 'main', dayOfWeek: 0, timeOfDay: '17:30', teacherId: 7, teacherName: 'أمل', teacherTypes: ['courseteacher'] },
  { id: 2, sessionType: 'training', dayOfWeek: 2, timeOfDay: '10:00', teacherId: null, teacherName: null, teacherType: null },
];

// ── Panel ────────────────────────────────────────────────────────────────────

test('panel: owner sees slots, week view, and an add button', async () => {
  const store = ttStorage({ listScheduleSlots: async () => SLOTS });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tt:5', '5'] });
  await handlers(store).panel(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:ttslot:5:1'));
  assert.ok(data.includes('o:ttslot:5:2'));
  assert.ok(data.includes('o:ttweek:5'));
  assert.ok(data.includes('o:ttadd:5'));
});

test('panel: assistant sees the week view but no add button', async () => {
  const store = ttStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'assistant', name: 'صف' }),
    listScheduleSlots: async () => SLOTS,
  });
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:tt:5', '5'] });
  await handlers(store).panel(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:ttweek:5'));
  assert.ok(!data.includes('o:ttadd:5'));
});

// ── Add flow ─────────────────────────────────────────────────────────────────

test('addPickType: lists the schedulable session types', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttadd:5', '5'] });
  await handlers(ttStorage()).addPickType(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:ttaddt:5:main'));
  assert.ok(data.includes('o:ttaddt:5:training'));
  assert.ok(data.includes('o:ttaddt:5:homeworkReview'));
});

test('addPickDay: shows all seven weekdays', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttaddt:5:main', '5', 'main'] });
  await handlers(ttStorage()).addPickDay(ctx);
  const data = editData(calls).filter((c) => /^o:ttaddd:5:main:\d$/.test(c));
  assert.equal(data.length, 7);
});

test('addPickDay: offers a bulk-add button', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttaddt:5:main', '5', 'main'] });
  await handlers(ttStorage()).addPickDay(ctx);
  assert.ok(editData(calls).includes('o:ttbulk:5:main'));
});

test('addBulkPrompt: stores a timetableBulk reply prompt', async () => {
  const prompts = [];
  const store = ttStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:ttbulk:5:main', '5', 'main'] });
  await handlers(store).addBulkPrompt(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'timetableBulk');
  assert.equal(prompts[0].sessionType, 'main');
});

test('onMessage: a bulk reply creates one slot per valid line and refreshes', async () => {
  const added = [];
  const store = ttStorage({
    getReplyPrompt: async () => ({ action: 'timetableBulk', groupId: 'offline:o:1', gref: '5', sessionType: 'main', chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => {},
    addScheduleSlot: async (g, slot) => { added.push(slot); return added.length; },
  });
  const telegram = makeTelegram();
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER },
    message: { message_id: 601, text: 'الأحد 10:00\nالثلاثاء 17:30\nالخميس 9:05', reply_to_message: { message_id: 600 } },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 602 }); },
  };
  let nextCalled = false;
  await handlers(store).onMessage(ctx, async () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.deepEqual(added.map((s) => [s.dayOfWeek, s.timeOfDay]), [[0, '10:00'], [2, '17:30'], [4, '09:05']]);
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('onMessage: bulk reports lines it could not parse', async () => {
  const added = [];
  const store = ttStorage({
    getReplyPrompt: async () => ({ action: 'timetableBulk', groupId: 'offline:o:1', gref: '5', sessionType: 'main', chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => {},
    addScheduleSlot: async (g, slot) => { added.push(slot); return added.length; },
  });
  const telegram = makeTelegram();
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER },
    message: { message_id: 601, text: 'الأحد 10:00\nنجمة غير صحيحة', reply_to_message: { message_id: 600 } },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 602 }); },
  };
  await handlers(store).onMessage(ctx, async () => {});
  assert.equal(added.length, 1);
  const replyText = calls.reply[0][0];
  assert.match(replyText, /نجمة غير صحيحة/);
});

test('addPromptTime: stores a timetableTime reply prompt', async () => {
  const prompts = [];
  const store = ttStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:ttaddd:5:main:0', '5', 'main', '0'] });
  await handlers(store).addPromptTime(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'timetableTime');
  assert.equal(prompts[0].sessionType, 'main');
  assert.equal(prompts[0].dayOfWeek, 0);
});

test('addPromptTime: homeworkReview adds an all-day slot immediately (no time prompt)', async () => {
  const added = [];
  const prompts = [];
  const store = ttStorage({
    addScheduleSlot: async (_g, slot) => { added.push(slot); return added.length; },
    setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); },
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttaddd:5:homeworkReview:3', '5', 'homeworkReview', '3'] });
  await handlers(store).addPromptTime(ctx);
  assert.equal(prompts.length, 0); // no force-reply for an all-day type
  assert.deepEqual(added.map((s) => [s.dayOfWeek, s.timeOfDay]), [[3, 'allday']]);
  assert.equal(calls.editMessageText.length, 1); // panel refreshed in place
});

test('addBulkPrompt: homeworkReview asks for days only (all-day)', async () => {
  const prompts = [];
  const store = ttStorage({ setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); } });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttbulk:5:homeworkReview', '5', 'homeworkReview'] });
  await handlers(store).addBulkPrompt(ctx);
  assert.equal(prompts[0].sessionType, 'homeworkReview');
  assert.match(calls.reply[0][0], /طوال اليوم/);
});

test('onMessage: an all-day bulk reply creates one slot per day', async () => {
  const added = [];
  const store = ttStorage({
    getReplyPrompt: async () => ({ action: 'timetableBulk', groupId: 'offline:o:1', gref: '5', sessionType: 'homeworkReview', chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => {},
    addScheduleSlot: async (_g, slot) => { added.push(slot); return added.length; },
  });
  const telegram = makeTelegram();
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER },
    message: { message_id: 601, text: 'الأحد\nالثلاثاء\nالخميس', reply_to_message: { message_id: 600 } },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 602 }); },
  };
  await handlers(store).onMessage(ctx, async () => {});
  assert.deepEqual(added.map((s) => [s.dayOfWeek, s.timeOfDay]), [[0, 'allday'], [2, 'allday'], [4, 'allday']]);
});

test('panel: shows the all-day label for a homework-review slot', async () => {
  const store = ttStorage({
    listScheduleSlots: async () => [
      { id: 3, sessionType: 'homeworkReview', dayOfWeek: 1, timeOfDay: 'allday', teacherId: null, teacherName: null, teacherTypes: null },
    ],
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tt:5', '5'] });
  await handlers(store).panel(ctx);
  const labels = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(labels.some((t) => t.includes('طوال اليوم')));
});

test('onMessage: a valid time reply creates the slot and refreshes the panel', async () => {
  const added = [];
  const store = ttStorage({
    getReplyPrompt: async () => ({ action: 'timetableTime', groupId: 'offline:o:1', gref: '5', sessionType: 'main', dayOfWeek: 3, chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => {},
    addScheduleSlot: async (g, slot) => { added.push([g, slot]); return 9; },
  });
  const telegram = makeTelegram();
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER },
    message: { message_id: 601, text: '9:05', reply_to_message: { message_id: 600 } },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 602 }); },
  };
  let nextCalled = false;
  await handlers(store).onMessage(ctx, async () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(added.length, 1);
  assert.equal(added[0][1].dayOfWeek, 3);
  assert.equal(added[0][1].timeOfDay, '09:05'); // normalized
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('onMessage: an invalid time keeps the prompt open (no slot created)', async () => {
  let added = 0;
  const store = ttStorage({
    getReplyPrompt: async () => ({ action: 'timetableTime', groupId: 'offline:o:1', gref: '5', sessionType: 'main', dayOfWeek: 3, chatId: 777, msgId: 600 }),
    addScheduleSlot: async () => { added += 1; return 9; },
  });
  const telegram = makeTelegram();
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER },
    message: { message_id: 601, text: '99:99', reply_to_message: { message_id: 600 } },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 602 }); },
  };
  await handlers(store).onMessage(ctx, async () => {});
  assert.equal(added, 0);
});

// ── Slot management ──────────────────────────────────────────────────────────

test('slotMenu: owner sees assign-teacher and remove', async () => {
  const store = ttStorage({ getScheduleSlot: async () => SLOTS[0] });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttslot:5:1', '5', '1'] });
  await handlers(store).slotMenu(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:ttasg:5:1'));
  assert.ok(data.includes('o:ttrm:5:1'));
  assert.ok(data.includes('o:tted:5:1')); // change day
  assert.ok(data.includes('o:ttet:5:1')); // change time (timed slot)
});

test('slotMenu: an all-day slot offers change-day but not change-time', async () => {
  const allDaySlot = { id: 3, sessionType: 'homeworkReview', dayOfWeek: 1, timeOfDay: 'allday', teacherId: null, teacherName: null, teacherTypes: null };
  const store = ttStorage({ getScheduleSlot: async () => allDaySlot });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttslot:5:3', '5', '3'] });
  await handlers(store).slotMenu(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:tted:5:3')); // change day
  assert.ok(!data.includes('o:ttet:5:3')); // no change-time for all-day
});

test('editDay: shows a day picker for the slot', async () => {
  const store = ttStorage({ getScheduleSlot: async () => SLOTS[0] });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tted:5:1', '5', '1'] });
  await handlers(store).editDay(ctx);
  const data = editData(calls);
  assert.ok(data.some((c) => /^o:ttsd:5:1:\d$/.test(c)));
});

test('editSetDay: updates the weekday and returns to the slot menu', async () => {
  const updates = [];
  const store = ttStorage({
    getScheduleSlot: async () => SLOTS[0],
    updateScheduleSlot: async (g, id, patch) => { updates.push([g, id, patch]); },
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttsd:5:1:4', '5', '1', '4'] });
  await handlers(store).editSetDay(ctx);
  assert.deepEqual(updates[0], ['offline:o:1', '1', { dayOfWeek: 4 }]);
  assert.equal(calls.answerCbQuery[0][0], TT.slotUpdated);
});

test('editPromptTime: stores a timetableEditTime reply prompt (timed slot)', async () => {
  const prompts = [];
  const store = ttStorage({
    getScheduleSlot: async () => SLOTS[0],
    setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); },
  });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:ttet:5:1', '5', '1'] });
  await handlers(store).editPromptTime(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].action, 'timetableEditTime');
  assert.equal(prompts[0].slotId, '1');
});

test('editPromptTime: refuses an all-day slot (no time to edit)', async () => {
  const prompts = [];
  const allDaySlot = { id: 3, sessionType: 'homeworkReview', dayOfWeek: 1, timeOfDay: 'allday', teacherId: null, teacherName: null, teacherTypes: null };
  const store = ttStorage({
    getScheduleSlot: async () => allDaySlot,
    setReplyPrompt: async (_c, _m, rec) => { prompts.push(rec); },
  });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:ttet:5:3', '5', '3'] });
  await handlers(store).editPromptTime(ctx);
  assert.equal(prompts.length, 0);
});

test('onMessage: an edit-time reply updates the slot and refreshes the menu', async () => {
  const updates = [];
  const store = ttStorage({
    getReplyPrompt: async () => ({ action: 'timetableEditTime', groupId: 'offline:o:1', gref: '5', slotId: '1', chatId: 777, msgId: 600 }),
    delReplyPrompt: async () => {},
    getScheduleSlot: async () => SLOTS[0],
    updateScheduleSlot: async (g, id, patch) => { updates.push([g, id, patch]); },
  });
  const telegram = makeTelegram();
  const calls = { reply: [] };
  const ctx = {
    chat: { id: 777, type: 'private' },
    from: { id: OWNER },
    message: { message_id: 601, text: '8:15', reply_to_message: { message_id: 600 } },
    telegram,
    reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 602 }); },
  };
  await handlers(store).onMessage(ctx, async () => {});
  assert.deepEqual(updates[0], ['offline:o:1', '1', { timeOfDay: '08:15' }]);
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('assignTeacher: sets the teacher and returns to the slot menu', async () => {
  const assigned = [];
  const store = ttStorage({
    getScheduleSlot: async () => SLOTS[0],
    setScheduleSlotTeacher: async (g, id, tid) => { assigned.push([g, id, tid]); },
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttasgd:5:1:7', '5', '1', '7'] });
  await handlers(store).assignTeacher(ctx);
  assert.deepEqual(assigned[0], ['offline:o:1', '1', 7]);
  assert.equal(calls.answerCbQuery[0][0], TT.teacherAssigned);
});

test('assignTeacher: teacherId 0 clears the teacher', async () => {
  const assigned = [];
  const store = ttStorage({
    getScheduleSlot: async () => SLOTS[0],
    setScheduleSlotTeacher: async (g, id, tid) => { assigned.push(tid); },
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttasgd:5:1:0', '5', '1', '0'] });
  await handlers(store).assignTeacher(ctx);
  assert.equal(assigned[0], null);
  assert.equal(calls.answerCbQuery[0][0], TT.teacherCleared);
});

test('removeExec: removes the slot and re-renders the panel', async () => {
  const removed = [];
  const store = ttStorage({ removeScheduleSlot: async (g, id) => { removed.push([g, id]); } });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttrmx:5:1', '5', '1'] });
  await handlers(store).removeExec(ctx);
  assert.deepEqual(removed[0], ['offline:o:1', '1']);
  assert.equal(calls.answerCbQuery[0][0], TT.removedToast);
});

// ── Week views ───────────────────────────────────────────────────────────────

test('week: groups slots by weekday with day headers', async () => {
  const store = ttStorage({ listScheduleSlots: async () => SLOTS });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttweek:5', '5'] });
  await handlers(store).week(ctx);
  const text = calls.editMessageText[0][0];
  assert.match(text, /الأحد/);   // day 0
  assert.match(text, /الثلاثاء/); // day 2
  assert.match(text, /17:30/);
});

test('myWeek: aggregates every class the user manages', async () => {
  const store = ttStorage({
    listScheduleForUser: async () => [
      { id: 1, groupId: 10, className: 'حلقة أ', sessionType: 'main', dayOfWeek: 0, timeOfDay: '17:30', teacherName: 'أمل', timezone: 'Asia/Riyadh' },
      { id: 2, groupId: 20, className: 'حلقة ب', sessionType: 'training', dayOfWeek: 0, timeOfDay: '09:00', teacherName: null, timezone: 'Africa/Cairo' },
    ],
  });
  const calls = { reply: [] };
  const ctx = { chat: { id: 777, type: 'private' }, from: { id: OWNER }, reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 1 }); } };
  await handlers(store).myWeek(ctx);
  assert.equal(calls.reply.length, 1);
  assert.match(calls.reply[0][0], /حلقة أ/);
  assert.match(calls.reply[0][0], /حلقة ب/);
});

test('myWeek: with no slots shows the empty message', async () => {
  const store = ttStorage({ listScheduleForUser: async () => [] });
  const calls = { reply: [] };
  const ctx = { chat: { id: 777, type: 'private' }, from: { id: OWNER }, reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 1 }); } };
  await handlers(store).myWeek(ctx);
  assert.match(calls.reply[0][0], /لا توجد مواعيد/);
});

// ── Timezone ─────────────────────────────────────────────────────────────────

test('panel: owner sees the timezone button and current zone header', async () => {
  const store = ttStorage({ getClassTimezone: async () => 'Africa/Cairo' });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tt:5', '5'] });
  await handlers(store).panel(ctx);
  assert.ok(editData(calls).includes('o:tttz:5'));
  assert.match(calls.editMessageText[0][0], /القاهرة/);
});

test('panel: assistant does not see the timezone button', async () => {
  const store = ttStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'assistant', name: 'صف' }),
  });
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:tt:5', '5'] });
  await handlers(store).panel(ctx);
  assert.ok(!editData(calls).includes('o:tttz:5'));
});

test('tzPicker: lists zones and marks the current one', async () => {
  const store = ttStorage({ getClassTimezone: async () => 'Africa/Cairo' });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tttz:5', '5'] });
  await handlers(store).tzPicker(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:tttzx:5:Asia/Riyadh'));
  assert.ok(data.includes('o:tttzx:5:Africa/Cairo'));
  const labels = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(labels.some((l) => l.startsWith('✅') && /القاهرة/.test(l)));
});

test('tzApply: persists the chosen zone and returns to the panel', async () => {
  let saved = null;
  const store = ttStorage({ setClassTimezone: async (g, tz) => { saved = [g, tz]; } });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tttzx:5:Africa/Cairo', '5', 'Africa/Cairo'] });
  await handlers(store).tzApply(ctx);
  assert.deepEqual(saved, ['offline:o:1', 'Africa/Cairo']);
  assert.equal(calls.answerCbQuery[0][0], TT.tzUpdated);
  assert.ok(editData(calls).includes('o:ttadd:5'));
});

test('tzApply: rejects an unknown zone', async () => {
  let saved = false;
  const store = ttStorage({ setClassTimezone: async () => { saved = true; } });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tttzx:5:Mars/Base', '5', 'Mars/Base'] });
  await handlers(store).tzApply(ctx);
  assert.equal(saved, false);
  assert.equal(calls.answerCbQuery[0][0], TT.missing);
});

test('tzPicker: assistant is blocked', async () => {
  const store = ttStorage({
    resolveManageableClass: async (gref) => ({ groupId: 'offline:o:1', rowId: Number(gref), role: 'assistant', name: 'صف' }),
  });
  const { ctx, calls } = makeCtx({ userId: DELEGATE, match: ['o:tttz:5', '5'] });
  await handlers(store).tzPicker(ctx);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

// ── All-zones browser (full IANA coverage) ───────────────────────────────────

test('tzPicker: offers an "all zones" browser entry', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tttz:5', '5'] });
  await handlers(ttStorage()).tzPicker(ctx);
  assert.ok(editData(calls).includes('o:tzr:5'));
});

test('tzRegions: lists geographic regions that drill into zone pages', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tzr:5', '5'] });
  await handlers(ttStorage()).tzRegions(ctx);
  const data = editData(calls);
  assert.ok(data.some((cb) => /^o:tzp:5:\d+:0$/.test(cb)));
});

test('tzZonesPage: lists concrete zones wired to the class apply callback', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tzp:5:0:0', '5', '0', '0'] });
  await handlers(ttStorage()).tzZonesPage(ctx);
  const data = editData(calls);
  assert.ok(data.some((cb) => cb.startsWith('o:tttzx:5:')));
});

test('tzApply: accepts any valid IANA zone, not just the curated list', async () => {
  let saved = null;
  const store = ttStorage({ setClassTimezone: async (g, tz) => { saved = [g, tz]; } });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:tttzx:5:America/New_York', '5', 'America/New_York'] });
  await handlers(store).tzApply(ctx);
  assert.deepEqual(saved, ['offline:o:1', 'America/New_York']);
  assert.equal(calls.answerCbQuery[0][0], TT.tzUpdated);
});

test('viewTzApply: accepts any valid IANA zone', async () => {
  let saved = null;
  const store = ttStorage({ setUserTimezone: async (u, tz) => { saved = tz; } });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:vtzx:m:0:America/New_York', 'm', '0', 'America/New_York'] });
  await handlers(store).viewTzApply(ctx);
  assert.equal(saved, 'America/New_York');
});

test('viewTzZonesPage: wires zones to the viewer apply callback', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:vzp:m:0:0:0', 'm', '0', '0', '0'] });
  await handlers(ttStorage()).viewTzZonesPage(ctx);
  const data = editData(calls);
  assert.ok(data.some((cb) => cb.startsWith('o:vtzx:m:0:')));
});

// ── Viewer preferences: time conversion + week start ─────────────────────────

test('week: converts times into the viewer timezone', async () => {
  // Asia/Riyadh (+3) and Asia/Dubai (+4) have no DST → a stable +1h shift.
  const store = ttStorage({
    listScheduleSlots: async () => [
      { id: 1, sessionType: 'main', dayOfWeek: 0, timeOfDay: '10:00', teacherId: null, teacherName: null, teacherType: null },
    ],
    getClassTimezone: async () => 'Asia/Riyadh',
    getUserPrefs: async () => ({ timezone: 'Asia/Dubai', weekStart: 6 }),
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttweek:5', '5'] });
  await handlers(store).week(ctx);
  const text = calls.editMessageText[0][0];
  assert.match(text, /11:00/);          // 10:00 Riyadh → 11:00 Dubai
  assert.match(text, /دبي/);            // header shows the view timezone
});

test('week: crossing midnight rolls the weekday forward', async () => {
  const store = ttStorage({
    listScheduleSlots: async () => [
      { id: 1, sessionType: 'main', dayOfWeek: 0, timeOfDay: '23:30', teacherId: null, teacherName: null, teacherType: null },
    ],
    getClassTimezone: async () => 'Asia/Riyadh',
    getUserPrefs: async () => ({ timezone: 'Asia/Dubai', weekStart: 6 }),
  });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttweek:5', '5'] });
  await handlers(store).week(ctx);
  const text = calls.editMessageText[0][0];
  // 23:30 Sunday Riyadh → 00:30 Monday Dubai.
  assert.match(text, /00:30/);
  assert.match(text, /الإثنين/);
});

test('week: orders days from the viewer week-start', async () => {
  const slots = [
    { id: 1, sessionType: 'main', dayOfWeek: 6, timeOfDay: '10:00', teacherId: null, teacherName: null, teacherType: null },
    { id: 2, sessionType: 'main', dayOfWeek: 0, timeOfDay: '10:00', teacherId: null, teacherName: null, teacherType: null },
  ];
  const satFirst = ttStorage({ listScheduleSlots: async () => slots, getUserPrefs: async () => ({ timezone: 'Africa/Cairo', weekStart: 6 }), getClassTimezone: async () => 'Africa/Cairo' });
  const c1 = makeCtx({ userId: OWNER, match: ['o:ttweek:5', '5'] });
  await handlers(satFirst).week(c1.ctx);
  const t1 = c1.calls.editMessageText[0][0];
  assert.ok(t1.indexOf('السبت') < t1.indexOf('الأحد'));

  const sunFirst = ttStorage({ listScheduleSlots: async () => slots, getUserPrefs: async () => ({ timezone: 'Africa/Cairo', weekStart: 0 }), getClassTimezone: async () => 'Africa/Cairo' });
  const c2 = makeCtx({ userId: OWNER, match: ['o:ttweek:5', '5'] });
  await handlers(sunFirst).week(c2.ctx);
  const t2 = c2.calls.editMessageText[0][0];
  assert.ok(t2.indexOf('الأحد') < t2.indexOf('السبت'));
});

test('viewTzPicker: offers a follow-class option and marks the current zone', async () => {
  const store = ttStorage({ getUserPrefs: async () => ({ timezone: 'Asia/Dubai', weekStart: 6 }) });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:vtz:c:5', 'c', '5'] });
  await handlers(store).viewTzPicker(ctx);
  const data = editData(calls);
  assert.ok(data.includes('o:vtzx:c:5:auto'));
  assert.ok(data.includes('o:vtzx:c:5:Asia/Dubai'));
  const labels = calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(labels.some((l) => l.startsWith('✅') && /دبي/.test(l)));
});

test('viewTzApply: persists the viewer zone and returns to the class week', async () => {
  let saved = 'unset';
  const store = ttStorage({ setUserTimezone: async (_u, tz) => { saved = tz; } });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:vtzx:c:5:Asia/Dubai', 'c', '5', 'Asia/Dubai'] });
  await handlers(store).viewTzApply(ctx);
  assert.equal(saved, 'Asia/Dubai');
  assert.equal(calls.answerCbQuery[0][0], TT.viewTzUpdated);
  assert.ok(editData(calls).includes('o:vtz:c:5')); // back on the class week view
});

test('viewTzApply: auto clears the viewer zone', async () => {
  let saved = 'unset';
  const store = ttStorage({ setUserTimezone: async (_u, tz) => { saved = tz; } });
  const { ctx } = makeCtx({ userId: OWNER, match: ['o:vtzx:m:0:auto', 'm', '0', 'auto'] });
  await handlers(store).viewTzApply(ctx);
  assert.equal(saved, null);
});

test('weekStartApply: persists the chosen start day and re-renders my-week', async () => {
  let saved = -1;
  const store = ttStorage({ setUserWeekStart: async (_u, d) => { saved = d; }, listScheduleForUser: async () => [] });
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:vwsx:m:0:1', 'm', '0', '1'] });
  await handlers(store).weekStartApply(ctx);
  assert.equal(saved, 1);
  assert.equal(calls.answerCbQuery[0][0], TT.weekStartUpdated);
});

test('myWeek: carries the viewer-preference buttons', async () => {
  const store = ttStorage({ listScheduleForUser: async () => [] });
  const calls = { reply: [] };
  const ctx = { chat: { id: 777, type: 'private' }, from: { id: OWNER }, reply(...a) { calls.reply.push(a); return Promise.resolve({ message_id: 1 }); } };
  await handlers(store).myWeek(ctx);
  const data = calls.reply[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('o:vtz:m:0'));
  assert.ok(data.includes('o:vws:m:0'));
});
