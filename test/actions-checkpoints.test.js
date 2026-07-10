import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/checkpoints.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

test('confirm: no active session answers noSessionActive', async () => {
  const storage = makeStorage({ getSession: async () => null });
  const { confirm } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ match: ['cp:confirm:1', '1'] });

  await confirm(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSessionActive]]);
});

test('confirm: missing checkpoint id answers checkpointMissing', async () => {
  const session = { type: 'main', active: true, checkpoints: [], participants: {} };
  const storage = makeStorage({
    getSession: async (_g, type) => (type === 'main' ? session : null),
    getMaster: async () => ({ members: [] }),
  });
  const { confirm } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ match: ['cp:confirm:9', '9'] });

  await confirm(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.checkpointMissing]]);
});

test('confirm: non-member is asked to register', async () => {
  const session = {
    type: 'main', active: true,
    checkpoints: [{ id: 1, kind: 'start', confirmations: {} }],
    participants: {},
  };
  const storage = makeStorage({
    getSession: async (_g, type) => (type === 'main' ? session : null),
    getMaster: async () => ({ members: [] }),
  });
  const { confirm } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ match: ['cp:confirm:1', '1'] });

  await confirm(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.needRegistration]]);
});

test('confirm: registered attendee records a confirmation and saves', async () => {
  let saved = null;
  const session = {
    type: 'main', active: true,
    checkpoints: [{ id: 1, kind: 'start', confirmations: {} }],
    participants: { 'سارة': { name: 'سارة' } },
  };
  const storage = makeStorage({
    getSession: async (_g, type) => (type === 'main' ? session : null),
    getMaster: async () => ({ members: [{ name: 'سارة', userId: '999' }] }),
    saveSession: async (_g, _t, s) => { saved = s; },
  });
  const { confirm } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ userId: 999, match: ['cp:confirm:1', '1'] });

  await confirm(ctx);

  assert.ok(saved);
  assert.ok(saved.checkpoints[0].confirmations['سارة']);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.checkpointConfirmedStart]]);
});
