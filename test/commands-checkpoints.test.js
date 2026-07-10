import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/checkpoints.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

function cpStorage(overrides = {}) {
  return makeStorage({
    getSession: async () => null,
    saveSession: async () => {},
    ...overrides,
  });
}

test('lessonstart: non-admin is rejected', async () => {
  const { lessonstart } = createHandlers({ storage: cpStorage() });
  const { ctx, calls } = makeCtx();

  await lessonstart(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('lessonstart: admin with no active session reports no session', async () => {
  const { lessonstart } = createHandlers({ storage: cpStorage({ getSession: async () => null }) });
  const { ctx, calls } = makeCtx({ admin: true });

  await lessonstart(ctx);

  assert.equal(calls.reply[0][0], TEXT.noSessionActive);
});

test('lessonstart: admin with an active main session posts a checkpoint and saves', async () => {
  let saved = null;
  const session = { name: 'مجلس', active: true, type: 'main' };
  const { lessonstart } = createHandlers({
    storage: cpStorage({
      getSession: async (_g, type) => (type === 'main' ? session : null),
      saveSession: async (_g, _t, s) => { saved = s; },
    }),
  });
  const { ctx, calls } = makeCtx({ admin: true });

  await lessonstart(ctx);

  assert.equal(calls.replyWithMarkdown.length, 1); // the checkpoint prompt
  assert.ok(saved);
  assert.equal(saved.checkpoints.length, 1);
  assert.equal(saved.checkpoints[0].kind, 'start');
});

test('onMessage: passes through when message is not a video_chat_started event', async () => {
  const { onMessage } = createHandlers({ storage: cpStorage() });
  const { ctx } = makeCtx();
  let nextCalled = false;

  await onMessage(ctx, async () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
