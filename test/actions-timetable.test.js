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
    removeScheduleSlot: async () => {},
    listScheduleForUser: async () => [],
    getTeachers: async () => [],
    getClassTimezone: async () => 'Asia/Riyadh',
    setClassTimezone: async () => {},
    ...overrides,
  });
}

const handlers = (store) => createHandlers({ storage: store });

function editData(calls) {
  return calls.editMessageText[0][1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

const SLOTS = [
  { id: 1, sessionType: 'main', dayOfWeek: 0, timeOfDay: '17:30', teacherId: 7, teacherName: 'أمل', teacherType: 'courseteacher' },
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
});

test('addPickDay: shows all seven weekdays', async () => {
  const { ctx, calls } = makeCtx({ userId: OWNER, match: ['o:ttaddt:5:main', '5', 'main'] });
  await handlers(ttStorage()).addPickDay(ctx);
  const data = editData(calls).filter((c) => /^o:ttaddd:5:main:\d$/.test(c));
  assert.equal(data.length, 7);
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
