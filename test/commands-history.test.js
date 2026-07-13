import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/history.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

function historyStorage(overrides = {}) {
  // getAllSessions is metadata-only; aggregates hydrate rosters on demand via
  // getSessionParticipants. Attach stable synthetic ids to fixtures and derive
  // a matching getSessionParticipants from them.
  const rawGetAll = overrides.getAllSessions || (async () => []);
  const getAllSessions = async (...args) => {
    const list = await rawGetAll(...args);
    return (list || []).map((s, i) => (s && s.id == null ? { ...s, id: `sid-${i}` } : s));
  };
  const store = makeStorage({
    getCurrentSeries: async () => 1,
    getSession: async () => null,
    getTrainingGroups: async () => [],
    ...overrides,
    getAllSessions,
  });
  if (!overrides.getSessionParticipants) {
    store.getSessionParticipants = async (_groupId, ids) => {
      const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
      const list = await getAllSessions();
      const out = {};
      for (const s of list) if (wanted.has(String(s.id))) out[s.id] = s.participants || {};
      return out;
    };
  }
  return store;
}

test('classhistory: non-admin is rejected', async () => {
  const { classhistory } = createHandlers({ storage: historyStorage() });
  const { ctx, calls } = makeCtx({ text: '/classhistory' });

  await classhistory(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('classhistory: admin with no records for the series reports none', async () => {
  const { classhistory } = createHandlers({
    storage: historyStorage({ getAllSessions: async () => [], getCurrentSeries: async () => 3 }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/classhistory' });

  await classhistory(ctx);

  assert.equal(calls.reply[0][0], TEXT.noSeriesRecords(3));
});

test('classhistory: admin with records sends the history home panel to the DM', async () => {
  const sessions = [{ seriesId: 2, name: 'جلسة', participants: {} }];
  const telegram = makeTelegram();
  const { classhistory } = createHandlers({
    storage: historyStorage({ getAllSessions: async () => sessions, getCurrentSeries: async () => 2 }),
    telegram,
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/classhistory' });

  await classhistory(ctx);

  assert.equal(telegram.calls.sendMessage.length, 1, 'panel delivered to DM');
  assert.equal(telegram.calls.sendMessage[0][0], ctx.from.id, 'panel sent to the requesting admin');
  assert.equal(calls.reply[0][0], TEXT.panelSentToDm, 'admin gets an ephemeral confirmation');
});
