import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/members.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('pick: non-admin is rejected', async () => {
  const { pick } = createHandlers({ storage: makeStorage(), telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ match: ['mb:pick:0', '0'] });

  await pick(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('deleteMember: unknown index answers memberNotFound', async () => {
  const storage = makeStorage({ getMaster: async () => ({ members: [] }) });
  const { deleteMember } = createHandlers({ storage, telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:del:0', '0'] });

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
    telegram: makeTelegram(),
    refreshSessionWidget: async () => { refreshed = true; },
  });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:del:0', '0'] });

  await deleteMember(ctx);

  assert.ok(savedMaster);
  assert.equal(savedMaster.members.length, 0);
  assert.equal(refreshed, true);
  assert.equal(calls.editMessageText.length, 1);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberDeletedShort('سارة')]]);
});

test('rename: unknown index answers memberNotFound', async () => {
  const storage = makeStorage({ getMaster: async () => ({ members: [] }) });
  const { rename } = createHandlers({ storage, telegram: makeTelegram() });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:rename:0', '0'] });

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
  const { add } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ admin: true, match: ['pr:add:42:0', '42', '0'] });

  await add(ctx);

  // Approved into the training group's roster
  assert.ok(savedMaster);
  assert.equal(savedMaster.members[0].userId, '42');
  // And backfilled into the linked main group
  assert.equal(addMembersCalls.length, 1);
  assert.equal(addMembersCalls[0][0], '-100999');
  assert.deepEqual(addMembersCalls[0][1], [{ userId: '42', name: 'ليان' }]);
});
