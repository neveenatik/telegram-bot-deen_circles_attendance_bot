import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/hub.js';
import { makeCtx, makeTelegram, makeStorage } from './mocks.js';
import { TEXT } from '../lib/text.js';

const HUB = TEXT.manageHub;

function cbData(calls, method) {
  return (calls[method][0][1].reply_markup.inline_keyboard || [])
    .flat()
    .map((b) => b.callback_data);
}

test('/manage delivers the hub to the admin DM and acks in group', async () => {
  const { ctx, calls, telegram } = makeCtx({ chatType: 'group', admin: true, chatId: 123 });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.manage(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], ctx.from.id);
  assert.equal(telegram.calls.sendMessage[0][1], HUB.title);
  const data = telegram.calls.sendMessage[0][2].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(data, ['mg:members:123', 'mg:pending:123', 'mg:history:123', 'mg:teach:123', 'mg:tgroups:123', 'mg:mat:123', 'o:root', 'msg:dismiss']);
  assert.equal(calls.reply[0][0], TEXT.panelSentToDm);
});

test('/manage is admin-only', async () => {
  const { ctx, calls, telegram } = makeCtx({ chatType: 'group', admin: false });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.manage(ctx);

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('/manage falls back to a start-in-DM nudge when the DM send fails', async () => {
  const telegram = makeTelegram({ sendMessage: async () => { throw new Error('bot was blocked'); } });
  const { ctx, calls } = makeCtx({ chatType: 'group', admin: true });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.manage(ctx);

  assert.match(calls.reply[0][0], /start=manage/);
});

test('mg:home re-renders the hub in place', async () => {
  const telegram = makeTelegram();
  const { ctx, calls } = makeCtx({ match: ['mg:home:123', '123'] });
  const h = createHandlers({ storage: makeStorage(), telegram });

  await h.home(ctx);

  assert.equal(calls.editMessageText[0][0], HUB.title);
  assert.deepEqual(cbData(calls, 'editMessageText'), ['mg:members:123', 'mg:pending:123', 'mg:history:123', 'mg:teach:123', 'mg:tgroups:123', 'mg:mat:123', 'o:root', 'msg:dismiss']);
});

test('mg:members opens the members panel with a back-to-hub row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getMaster: async () => ({ members: [{ name: 'سارة' }] }) });
  const { ctx, calls } = makeCtx({ match: ['mg:members:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openMembers(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.includes('msg:dismiss'), 'keeps the close row');
  assert.ok(data.some((d) => d.startsWith('mb:123:')), 'renders members buttons');
});

test('mg:pending opens the pending panel with a back-to-hub row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getPendingRegistrations: async () => [{ userId: 7, name: 'مريم' }] });
  const { ctx, calls } = makeCtx({ match: ['mg:pending:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openPending(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.includes('msg:dismiss'), 'keeps the close row');
});

test('mg:history opens the history home with a back-to-hub row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({
    getAllSessions: async () => [{ type: 'main', seriesId: 1, name: 'جلسة', startedAt: 1 }],
    getCurrentSeries: async () => 1,
  });
  const { ctx, calls } = makeCtx({ match: ['mg:history:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openHistory(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.some((d) => d.startsWith('h:rep:123:')), 'renders history actions');
});

test('mg:history alerts when the current series has no records', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getAllSessions: async () => [], getCurrentSeries: async () => 3 });
  const { ctx, calls } = makeCtx({ match: ['mg:history:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openHistory(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.noSeriesRecords(3));
});

test('mg: actions are gated to admins of the originating group', async () => {
  const telegram = makeTelegram({ getChatMember: async () => ({ status: 'member' }) });
  const storage = makeStorage({ getMaster: async () => ({ members: [] }) });
  const { ctx, calls } = makeCtx({ match: ['mg:members:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openMembers(ctx);

  assert.equal(calls.editMessageText.length, 0);
  assert.equal(calls.answerCbQuery[0][0], TEXT.adminOnly);
});

// ── Teachers editor ───────────────────────────────────────────────────

const SAMPLE_TEACHERS = [
  { userId: '111', name: 'أمل', type: 'courseteacher' },
  { userId: '222', name: 'هدى', type: 'recitationteacher' },
];

test('mg:teach lists teachers with add, back-to-hub and close rows', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getTeachers: async () => SAMPLE_TEACHERS });
  const { ctx, calls } = makeCtx({ match: ['mg:teach:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openTeachers(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:tadd:123'), 'has add-teacher button');
  assert.ok(data.includes('mg:tch:123:111'), 'first teacher is tappable');
  assert.ok(data.includes('mg:tch:123:222'), 'second teacher is tappable');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.includes('msg:dismiss'), 'has close row');
});

test('mg:tch opens a teacher menu (rename / change type / remove)', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getTeachers: async () => SAMPLE_TEACHERS });
  const { ctx, calls } = makeCtx({ match: ['mg:tch:123:111', '123', '111'] });
  const h = createHandlers({ storage, telegram });

  await h.teacherMenu(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.deepEqual(data, ['mg:tren:123:111', 'mg:ttype:123:111', 'mg:trm:123:111', 'mg:teach:123', 'msg:dismiss']);
});

test('mg:ttset changes a teacher type and persists it', async () => {
  const saved = [];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getTeachers: async () => JSON.parse(JSON.stringify(SAMPLE_TEACHERS)),
    saveTeachers: async (_gid, list) => { saved.push(list); },
  });
  const { ctx, calls } = makeCtx({ match: ['mg:ttset:123:111:trainingteacher', '123', '111', 'trainingteacher'] });
  const h = createHandlers({ storage, telegram });

  await h.setTeacherType(ctx);

  assert.equal(saved[0].find((t) => t.userId === '111').type, 'trainingteacher');
  assert.deepEqual(cbData(calls, 'editMessageText'), ['mg:tren:123:111', 'mg:ttype:123:111', 'mg:trm:123:111', 'mg:teach:123', 'msg:dismiss']);
});

test('mg:trmx removes a teacher and returns to the list', async () => {
  const saved = [];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getTeachers: async () => JSON.parse(JSON.stringify(SAMPLE_TEACHERS)),
    saveTeachers: async (_gid, list) => { saved.push(list); },
  });
  const { ctx, calls } = makeCtx({ match: ['mg:trmx:123:111', '123', '111'] });
  const h = createHandlers({ storage, telegram });

  await h.removeTeacher(ctx);

  assert.deepEqual(saved[0].map((t) => t.userId), ['222']);
  const data = cbData(calls, 'editMessageText');
  assert.ok(!data.includes('mg:tch:123:111'), 'removed teacher is gone');
  assert.ok(data.includes('mg:tch:123:222'), 'remaining teacher stays');
});

test('mg:tadd opens a force-reply prompt awaiting a group add', async () => {
  const prompts = [];
  const telegram = makeTelegram();
  const storage = makeStorage({ setReplyPrompt: async (_c, _m, record) => { prompts.push(record); } });
  const { ctx } = makeCtx({ match: ['mg:tadd:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.addTeacherPrompt(ctx);

  assert.equal(prompts[0].action, 'groupAddTeacher');
  assert.equal(prompts[0].groupId, '123');
});

// ── Training-groups editor ────────────────────────────────────────────

const SAMPLE_TRAINING_GROUPS = [
  { groupId: '-1001', name: 'تدريب أ' },
  { groupId: '-1002', name: 'تدريب ب' },
];

test('mg:tgroups lists training groups with add, back-to-hub and close rows', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getTrainingGroups: async () => SAMPLE_TRAINING_GROUPS });
  const { ctx, calls } = makeCtx({ match: ['mg:tgroups:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.openTrainingGroups(ctx);

  const data = cbData(calls, 'editMessageText');
  assert.ok(data.includes('mg:tgadd:123'), 'has add button');
  assert.ok(data.includes('mg:tg:123:-1001'), 'first group is tappable');
  assert.ok(data.includes('mg:tg:123:-1002'), 'second group is tappable');
  assert.ok(data.includes('mg:home:123'), 'has back-to-hub row');
  assert.ok(data.includes('msg:dismiss'), 'has close row');
});

test('mg:tg opens a training-group menu (rename / remove)', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getTrainingGroups: async () => SAMPLE_TRAINING_GROUPS });
  const { ctx, calls } = makeCtx({ match: ['mg:tg:123:-1001', '123', '-1001'] });
  const h = createHandlers({ storage, telegram });

  await h.trainingGroupMenu(ctx);

  assert.deepEqual(cbData(calls, 'editMessageText'), ['mg:tgstu:123:-1001', 'mg:tgren:123:-1001', 'mg:tgrm:123:-1001', 'mg:tgroups:123', 'msg:dismiss']);
});

test('mg:tgstu lists the training group roster with a back-to-menu row', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({
    getTrainingGroups: async () => SAMPLE_TRAINING_GROUPS,
    getMaster: async (gid) => (String(gid) === '-1001'
      ? { members: [{ userId: 11, name: 'مريم' }, { userId: 22, name: 'سارة' }] }
      : { members: [] }),
  });
  const { ctx, calls } = makeCtx({ match: ['mg:tgstu:123:-1001', '123', '-1001'] });
  const h = createHandlers({ storage, telegram });

  await h.trainingGroupStudents(ctx);

  assert.match(calls.editMessageText[0][0], /مريم/);
  assert.match(calls.editMessageText[0][0], /سارة/);
  assert.deepEqual(cbData(calls, 'editMessageText'), ['mg:tg:123:-1001', 'msg:dismiss']);
});

test('mg:tgrmx removes a training group and returns to the list', async () => {
  const saved = [];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getTrainingGroups: async () => JSON.parse(JSON.stringify(SAMPLE_TRAINING_GROUPS)),
    saveTrainingGroups: async (_gid, list) => { saved.push(list); },
  });
  const { ctx, calls } = makeCtx({ match: ['mg:tgrmx:123:-1001', '123', '-1001'] });
  const h = createHandlers({ storage, telegram });

  await h.removeTrainingGroup(ctx);

  assert.deepEqual(saved[0].map((g) => g.groupId), ['-1002']);
  const data = cbData(calls, 'editMessageText');
  assert.ok(!data.includes('mg:tg:123:-1001'), 'removed group is gone');
  assert.ok(data.includes('mg:tg:123:-1002'), 'remaining group stays');
});

test('mg:tgadd opens a force-reply prompt awaiting a training-group add', async () => {
  const prompts = [];
  const telegram = makeTelegram();
  const storage = makeStorage({ setReplyPrompt: async (_c, _m, record) => { prompts.push(record); } });
  const { ctx } = makeCtx({ match: ['mg:tgadd:123', '123'] });
  const h = createHandlers({ storage, telegram });

  await h.addTrainingGroupPrompt(ctx);

  assert.equal(prompts[0].action, 'groupAddTrainingGroup');
  assert.equal(prompts[0].groupId, '123');
});

test('mg:tgren opens a force-reply prompt awaiting a training-group rename', async () => {
  const prompts = [];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getTrainingGroups: async () => SAMPLE_TRAINING_GROUPS,
    setReplyPrompt: async (_c, _m, record) => { prompts.push(record); },
  });
  const { ctx } = makeCtx({ match: ['mg:tgren:123:-1001', '123', '-1001'] });
  const h = createHandlers({ storage, telegram });

  await h.renameTrainingGroupPrompt(ctx);

  assert.equal(prompts[0].action, 'groupRenameTrainingGroup');
  assert.equal(prompts[0].trainingGroupId, '-1001');
});
