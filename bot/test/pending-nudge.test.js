import { test } from 'node:test';
import assert from 'node:assert/strict';

import { syncPendingNudge } from '../lib/pendingNudge.js';
import { createHandlers as createAttendanceHandlers } from '../lib/handlers/actions/attendance.js';
import { createHandlers as createMembersHandlers } from '../lib/handlers/actions/members.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('syncPendingNudge: posts a new nudge and stores the message id on the session', async () => {
  const session = { type: 'main', active: true };
  const saved = [];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getPendingRegistrations: async () => [{ userId: '1', name: 'أ' }],
    saveSession: async (...a) => { saved.push(a); },
  });

  await syncPendingNudge({ telegram, storage, groupId: 123, session, type: 'main' });

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(session.pendingNudgeMessageId, 900);
  assert.equal(saved.length, 1);
  // The one button opens the DM panel.
  assert.match(JSON.stringify(telegram.calls.sendMessage[0][2]), /pr:opendm/);
});

test('syncPendingNudge: edits the existing nudge instead of re-posting', async () => {
  const session = { type: 'main', active: true, pendingNudgeMessageId: 55 };
  const telegram = makeTelegram();
  const storage = makeStorage({
    getPendingRegistrations: async () => [{ userId: '1' }, { userId: '2' }],
  });

  await syncPendingNudge({ telegram, storage, groupId: 123, session, type: 'main' });

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.equal(telegram.calls.editMessageText.length, 1);
});

test('syncPendingNudge: removes the nudge when no requests remain', async () => {
  const session = { type: 'main', active: true, pendingNudgeMessageId: 55 };
  const saved = [];
  const telegram = makeTelegram();
  const storage = makeStorage({
    getPendingRegistrations: async () => [],
    saveSession: async (...a) => { saved.push(a); },
  });

  await syncPendingNudge({ telegram, storage, groupId: 123, session, type: 'main' });

  assert.equal(telegram.calls.deleteMessage.length, 1);
  assert.equal(session.pendingNudgeMessageId, null);
  assert.equal(saved.length, 1);
});

test('syncPendingNudge: no-op when there is no active session', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({ getActiveSession: async () => null });

  await syncPendingNudge({ telegram, storage, groupId: 123 });

  assert.equal(telegram.calls.sendMessage.length, 0);
  assert.equal(telegram.calls.editMessageText.length, 0);
  assert.equal(telegram.calls.deleteMessage.length, 0);
});

test('mark: a walk-in during a live main session posts the pending nudge in the group', async () => {
  let pendingStore = [];
  const session = { type: 'main', active: true, registrationActive: true, allowPublicRegistration: false, participants: {} };
  const telegram = makeTelegram();
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [] }),
    getPendingRegistrations: async () => pendingStore,
    savePendingRegistrations: async (_g, pending) => { pendingStore = pending; },
  });
  const { mark } = createAttendanceHandlers({ storage, telegram, refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' }, match: ['a:present', 'present'] });

  await mark(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.match(JSON.stringify(telegram.calls.sendMessage[0][2]), /pr:opendm/);
  assert.equal(session.pendingNudgeMessageId, 900);
});

test('openDm: delivers the pending panel to the admin DM', async () => {
  const telegram = makeTelegram();
  const storage = makeStorage({
    getPendingRegistrations: async () => [
      { userId: '7', name: 'خديجة', submittedAt: new Date().toISOString() },
    ],
  });
  const { openDm } = createMembersHandlers({ storage, telegram });
  const { ctx } = makeCtx({ admin: true });

  await openDm(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], ctx.from.id);
  assert.deepEqual(ctx.calls.answerCbQuery, [[TEXT.panelSentToDm]]);
});
