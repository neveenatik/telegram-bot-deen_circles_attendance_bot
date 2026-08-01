import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers as rawCreateHandlers } from '../lib/handlers/actions/groups.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

// The training sub-panel is DM-delivered, so its handlers verify admin via
// isAdminOf(telegram, groupId, userId). Supply a telegram whose getChatMember
// reports the desired membership status (default: administrator).
function createHandlers({ storage }, memberStatus = 'administrator') {
  return rawCreateHandlers({
    storage,
    telegram: makeTelegram({ getChatMember: async () => ({ status: memberStatus }) }),
  });
}

function groupsStorage(overrides = {}) {
  return makeStorage({ getTrainingGroups: async () => [], ...overrides });
}

test('assign: non-admin is rejected', async () => {
  const { assign } = createHandlers({ storage: groupsStorage() }, 'member');
  const { ctx, calls } = makeCtx({ match: ['mb:123:atrain:0:0', '123', '0', '0'] });

  await assign(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('assign: unknown member index answers memberNotFound', async () => {
  const storage = groupsStorage({ getMaster: async () => ({ members: [] }) });
  const { assign } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:atrain:0:0', '123', '0', '0'] });

  await assign(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});

test('assign: with no configured training groups alerts trainingGroupsEmpty', async () => {
  const storage = groupsStorage({
    getMaster: async () => ({ members: [{ name: 'سارة', userId: '1' }] }),
    getTrainingGroups: async () => [],
  });
  const { assign } = createHandlers({ storage });
  const { ctx, calls } = makeCtx({ admin: true, match: ['mb:123:atrain:0:0', '123', '0', '0'] });

  await assign(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.trainingGroupsEmpty, { show_alert: true }]]);
});
