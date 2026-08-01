import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/members.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

// The members/pending panels are DM-delivered, so handlers verify admin via
// isAdminOf(telegram, groupId, userId). Supply a telegram whose getChatMember
// reports the desired membership status (default: administrator).
function adminTelegram(memberStatus = 'administrator') {
  return makeTelegram({ getChatMember: async () => ({ status: memberStatus }) });
}

test('pick: non-admin is rejected', async () => {
  const { pick } = createHandlers({ storage: makeStorage(), telegram: adminTelegram('member') });
  const { ctx, calls } = makeCtx({ match: ['mb:123:pick:0', '123', '0'] });

  await pick(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('deleteMember: unknown index answers memberNotFound', async () => {
  const storage = makeStorage({ getMaster: async () => ({ members: [] }) });
  const { deleteMember } = createHandlers({ storage, telegram: adminTelegram() });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:del:0', '123', '0'] });

  await deleteMember(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('deleteMember: removes the member, updates the active session and refreshes', async () => {
  let savedMaster = null;
  let refreshed = false;
  const session = { type: 'main', active: true, participants: { 'سارة': { name: 'سارة' } } };
  const storage = makeStorage({
    getMaster: async () => ({ members: [{ name: 'سارة', userId: '1' }] }),
    saveMaster: async (_g, m) => { savedMaster = m; },
    getActiveSession: async () => ({ type: 'main', session }),
    getTrainingGroups: async () => [],
  });
  const { deleteMember } = createHandlers({
    storage,
    telegram: adminTelegram(),
    refreshSessionWidget: async () => { refreshed = true; },
  });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:del:0', '123', '0'] });

  await deleteMember(ctx);

  assert.ok(savedMaster);
  assert.equal(savedMaster.members.length, 0);
  assert.equal(refreshed, true);
  assert.equal(calls.editMessageText.length, 1);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberDeletedShort('سارة')]]);
});

test('rename: unknown index answers memberNotFound', async () => {
  const storage = makeStorage({ getMaster: async () => ({ members: [] }) });
  const { rename } = createHandlers({ storage, telegram: adminTelegram() });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:ren:0', '123', '0'] });

  await rename(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('add: approving a pending student in a training group backfills them into the main group', async () => {
  const addMembersCalls = [];
  let savedMaster = null;
  const storage = makeStorage({
    getPendingRegistrations: async () => [{ userId: '42', name: 'ليان' }],
    savePendingRegistrations: async () => {},
    getMaster: async () => ({ members: [] }),
    saveMaster: async (_g, m) => { savedMaster = m; },
    getSession: async () => null,
    getParentGroupId: async (gid) => (gid === '123' ? '-100999' : null),
    addMembers: async (gid, members) => { addMembersCalls.push([gid, members]); },
  });
  const { add } = createHandlers({ storage, telegram: adminTelegram(), refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ admin: true, match: ['pr:123:add:42:0', '123', '42', '0'] });

  await add(ctx);

  // Approved into the training group's roster
  assert.ok(savedMaster);
  assert.equal(savedMaster.members[0].userId, '42');
  // And backfilled into the linked main group
  assert.equal(addMembersCalls.length, 1);
  assert.equal(addMembersCalls[0][0], '-100999');
  assert.deepEqual(addMembersCalls[0][1], [{ userId: '42', name: 'ليان' }]);
});

test('sendConfirmations: welcomes only members without welcomedAt and stamps them', async () => {
  let savedMaster = null;
  const master = { members: [
    { userId: '1', name: 'ليان', welcomedAt: '2026-07-01T00:00:00.000Z' },
    { userId: '2', name: 'سارة' },
  ] };
  const storage = makeStorage({
    getMaster: async () => master,
    saveMaster: async (_g, m) => { savedMaster = m; },
  });
  const telegram = adminTelegram();
  const { sendConfirmations } = createHandlers({ storage, telegram });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:sendconfirmations', '123'] });

  await sendConfirmations(ctx);

  // The confirmation is posted to the group, not the admin's DM
  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], '123');
  assert.match(telegram.calls.sendMessage[0][1], /سارة/);
  assert.doesNotMatch(telegram.calls.sendMessage[0][1], /ليان/);
  // Alert reflects one newly welcomed member
  assert.deepEqual(calls.answerCbQuery, [[TEXT.batchConfirmationAlert(1), { show_alert: true }]]);
  // welcomedAt is now set on the previously un-welcomed member
  assert.ok(savedMaster.members.find((m) => m.userId === '2').welcomedAt);
});

test('sendConfirmations: reports when everyone is already welcomed', async () => {
  const master = { members: [
    { userId: '1', name: 'ليان', welcomedAt: '2026-07-01T00:00:00.000Z' },
  ] };
  const storage = makeStorage({ getMaster: async () => master });
  const telegram = adminTelegram();
  const { sendConfirmations } = createHandlers({ storage, telegram });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:sendconfirmations', '123'] });

  await sendConfirmations(ctx);

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.allMembersAlreadyConfirmed, { show_alert: true }]]);
});

test('sendConfirm: welcomes a single member and stamps welcomedAt', async () => {
  let savedMaster = null;
  const master = { members: [{ userId: '2', name: 'سارة' }] };
  const storage = makeStorage({
    getMaster: async () => master,
    saveMaster: async (_g, m) => { savedMaster = m; },
  });
  const telegram = adminTelegram();
  const { sendConfirm } = createHandlers({ storage, telegram });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:sendconfirm:0:0', '123', '0', '0'] });

  await sendConfirm(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], '123');
  assert.match(telegram.calls.sendMessage[0][1], /سارة/);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.confirmationSent]]);
  assert.ok(savedMaster.members[0].welcomedAt);
});
