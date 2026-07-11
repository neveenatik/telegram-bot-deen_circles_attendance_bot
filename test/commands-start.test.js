import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/start.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

function startStorage(overrides = {}) {
  return makeStorage({
    getSession: async () => null,
    saveSession: async () => {},
    getMaster: async () => ({ members: [] }),
    getCurrentSeries: async () => 1,
    getGroupRecitationNextPage: async () => 1,
    getTrainingGroups: async () => [],
    ...overrides,
  });
}

test('startlist: non-admin is rejected', async () => {
  const { startlist } = createHandlers({ storage: startStorage(), telegram: makeTelegram() });
  const { ctx, calls } = makeCtx();

  await startlist(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('startlist: admin with no active session creates and persists a main session', async () => {
  let refreshed = false;
  let saved = null;
  const storage = startStorage({
    getSession: async () => null,
    saveSession: async (_g, type, session) => { saved = { type, session }; },
    getMaster: async () => ({ members: [{ name: 'أ', userId: '1' }] }),
  });
  const { startlist } = createHandlers({
    storage,
    telegram: makeTelegram(),
    refreshSessionWidget: async () => { refreshed = true; },
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/startlist درس اليوم' });

  await startlist(ctx);

  assert.ok(saved, 'session should be persisted');
  assert.equal(saved.type, 'main');
  assert.equal(saved.session.name, 'درس اليوم');
  assert.equal(saved.session.active, true);
  // attendance initialized => the single member is a participant
  assert.ok(saved.session.participants['أ']);
  assert.equal(calls.replyWithMarkdown.length, 1);
  assert.equal(calls.pinChatMessage.length, 1);
  assert.equal(refreshed, true);
});

test('startlist: blocked when a session is already active', async () => {
  const activeSession = { type: 'main', active: true, chatId: 123, messageId: 10, participants: {} };
  const storage = startStorage({
    getSession: async (_g, type) => (type === 'main' ? activeSession : null),
  });
  let saved = false;
  const { startlist } = createHandlers({
    storage: { ...storage, saveSession: async () => { saved = true; } },
    telegram: makeTelegram(),
    refreshSessionWidget: async () => {},
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/startlist' });

  await startlist(ctx);

  // It resends the existing widget and replies refreshed, without creating a new session name
  assert.equal(calls.reply[0][0], TEXT.refreshed);
  assert.equal(saved, true); // resend persists the existing session's new message id
});

test('starttraininglist: is rejected when run in a group that has training groups configured', async () => {
  const storage = startStorage({
    getTrainingGroups: async () => [{ groupId: '-100999', name: 'مجموعة' }],
  });
  let saved = null;
  const { starttraininglist } = createHandlers({
    storage: { ...storage, saveSession: async (_g, type, session) => { saved = { type, session }; } },
    telegram: makeTelegram(),
    refreshSessionWidget: async () => {},
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/starttraininglist' });

  await starttraininglist(ctx);

  assert.equal(saved, null, 'no session should be created in a main group');
  assert.match(calls.reply[0][0], /مجموعات التدريب فقط/);
});

test('starttraininglist: starts a training list initialized from the assigned roster', async () => {
  const storage = startStorage({
    getTrainingGroups: async () => [],
    getMaster: async () => ({ members: [{ name: 'أ', userId: '1' }] }),
  });
  let saved = null;
  const { starttraininglist } = createHandlers({
    storage: { ...storage, saveSession: async (_g, type, session) => { saved = { type, session }; } },
    telegram: makeTelegram(),
    refreshSessionWidget: async () => {},
  });
  const { ctx } = makeCtx({ admin: true, text: '/starttraininglist' });

  await starttraininglist(ctx);

  assert.ok(saved, 'session should be persisted');
  assert.equal(saved.type, 'main');
  assert.equal(saved.session.name, 'حلقة التدريب');
  assert.equal(saved.session.active, true);
  // Initialized from the training group's assigned roster
  assert.deepEqual(Object.keys(saved.session.participants), ['أ']);
  // No public self-registration: members are assigned from the main group
  assert.equal(saved.session.allowPublicRegistration, false);
});
