import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/attendance.js';
import { TEXT, st } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('mark: registered member marking present saves the participant and refreshes', async () => {
  const saveParticipantCalls = [];
  let refreshed = false;
  const session = {
    type: 'main',
    active: true,
    registrationActive: true,
    participants: {},
  };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [{ userId: '999', name: 'سارة' }] }),
    saveParticipant: async (...args) => { saveParticipantCalls.push(args); },
  });
  const { mark } = createHandlers({
    storage,
    telegram: makeTelegram(),
    refreshSessionWidget: async () => { refreshed = true; },
  });
  const { ctx, calls } = makeCtx({ userId: 999, match: ['a:present', 'present'] });

  await mark(ctx);

  assert.equal(saveParticipantCalls.length, 1);
  assert.equal(saveParticipantCalls[0][0], '123');        // groupId
  assert.equal(saveParticipantCalls[0][1], 'main');       // activeType
  assert.equal(saveParticipantCalls[0][3], 'سارة');       // participant name
  assert.equal(refreshed, true);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.registeredAs(st('present').a), { show_alert: false }]]);
});

test('mark: public self-registration adds a new member and participant', async () => {
  let savedMaster = null;
  const saveParticipantCalls = [];
  const session = {
    type: 'open',
    active: true,
    registrationActive: true,
    allowPublicRegistration: true,
    participants: {},
  };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'open', session }),
    getMaster: async () => ({ members: [] }),
    saveMaster: async (_g, master) => { savedMaster = master; },
    saveParticipant: async (...args) => { saveParticipantCalls.push(args); },
  });
  const { mark } = createHandlers({
    storage,
    telegram: makeTelegram(),
    refreshSessionWidget: async () => {},
  });
  const { ctx } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' }, match: ['a:present', 'present'] });

  await mark(ctx);

  assert.ok(savedMaster);
  assert.equal(savedMaster.members.length, 1);
  assert.equal(savedMaster.members[0].userId, '42');
  assert.equal(saveParticipantCalls.length, 1);
});

test('refresh: admin with an active session refreshes the widget and answers', async () => {
  let refreshed = false;
  const session = { type: 'main', active: true, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [] }),
  });
  const { refresh } = createHandlers({
    storage,
    telegram: makeTelegram(),
    refreshSessionWidget: async () => { refreshed = true; },
  });
  const { ctx, calls } = makeCtx({ admin: true });

  await refresh(ctx);

  assert.equal(refreshed, true);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.refreshed]]);
});
