import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/attendance.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

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

test('mark: unregistered user without public registration is asked to register', async () => {
  const storage = makeStorage({
    getActiveSession: async () => ({
      type: 'main',
      session: { type: 'main', active: true, registrationActive: true, allowPublicRegistration: false },
    }),
    getMaster: async () => ({ members: [] }),
  });
  const { mark } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await mark(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.needRegistration]]);
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
