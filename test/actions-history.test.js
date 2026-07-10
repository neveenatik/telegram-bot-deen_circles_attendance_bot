import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/history.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

function historyStorage(overrides = {}) {
  return makeStorage({
    getAllSessions: async () => [],
    getSessions: async () => [],
    saveSessions: async () => {},
    ...overrides,
  });
}

test('home: non-admin is rejected', async () => {
  const { home } = createHandlers({ storage: historyStorage() });
  const { ctx, calls } = makeCtx({ match: ['h:home:2', '2'] });

  await home(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('home: admin with no records answers noSeriesRecords', async () => {
  const { home } = createHandlers({ storage: historyStorage({ getAllSessions: async () => [] }) });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:home:2', '2'] });

  await home(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSeriesRecords(2)]]);
});

test('home: admin with records edits the message and answers refreshed', async () => {
  const sessions = [{ seriesId: 2, name: 'جلسة', participants: {} }];
  const { home } = createHandlers({ storage: historyStorage({ getAllSessions: async () => sessions }) });
  const { ctx, calls } = makeCtx({ admin: true, match: ['h:home:2', '2'] });

  await home(ctx);

  assert.equal(calls.editMessageText.length, 1);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.refreshed]]);
});
