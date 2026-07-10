import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/groups.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

function groupsStorage(overrides = {}) {
  return makeStorage({ getTrainingGroups: async () => [], ...overrides });
}

test('assign: non-admin is rejected', async () => {
  const { assign } = createHandlers({ storage: groupsStorage() });
  const { ctx, calls } = makeCtx({ match: ['mb:atrain:0:0', '0', '0'] });

  await assign(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('assign: unknown member index answers memberNotFound', async () => {
  const storage = groupsStorage({ getMaster: async () => ({ members: [] }) });
  const { assign } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:atrain:0:0', '0', '0'] });

  await assign(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('assign: with no configured training groups alerts trainingGroupsEmpty', async () => {
  const storage = groupsStorage({
    getMaster: async () => ({ members: [{ name: 'سارة', userId: '1' }] }),
    getTrainingGroups: async () => [],
  });
  const { assign } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:atrain:0:0', '0', '0'] });

  await assign(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.trainingGroupsEmpty, { show_alert: true }]]);
});
