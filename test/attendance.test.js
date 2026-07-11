import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/attendance.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('refresh: non-admin (private chat) is rejected without touching storage', async () => {
  let saved = false;
  const storage = makeStorage({ saveSession: async () => { saved = true; } });
  const { refresh } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx({ chatType: 'private' });

  await refresh(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(saved, false);
});

test('mark: no active session answers noSessionActive', async () => {
  const storage = makeStorage({ getActiveSession: async () => null });
  const { mark } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await mark(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSessionActive]]);
});

test('mark: unregistered user on a roster list is queued as a pending registration', async () => {
  const savePendingCalls = [];
  let savedMaster = null;
  const session = { type: 'main', active: true, registrationActive: true, allowPublicRegistration: false, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [] }),
    saveMaster: async (_g, master) => { savedMaster = master; },
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async (gid, pending) => { savePendingCalls.push([gid, pending]); },
  });
  const { mark } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' }, match: ['a:present', 'present'] });

  await mark(ctx);

  // Queued for approval, not added to the roster on the spot.
  assert.equal(savePendingCalls.length, 1);
  assert.equal(savePendingCalls[0][1][0].userId, '42');
  assert.equal(savePendingCalls[0][1][0].name, 'ليان');
  assert.equal(savedMaster, null);
});

test('mark: closed registration clears the keyboard and alerts', async () => {
  const storage = makeStorage({
    getActiveSession: async () => ({
      type: 'main',
      session: { type: 'main', active: true, registrationActive: false },
    }),
  });
  const { mark } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await mark(ctx);

  assert.equal(calls.editMessageReplyMarkup.length, 1);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.registrationClosedAlert]]);
});
