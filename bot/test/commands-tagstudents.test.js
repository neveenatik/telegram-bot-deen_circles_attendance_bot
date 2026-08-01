import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/tagstudents.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

test('tagstudents: non-admin is rejected', async () => {
  const { tagstudents } = createHandlers({ storage: makeStorage() });
  const { ctx, calls } = makeCtx();

  await tagstudents(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('tagstudents: admin with no members reports empty members', async () => {
  const { tagstudents } = createHandlers({ storage: makeStorage({ getMaster: async () => ({ members: [] }) }) });
  const { ctx, calls } = makeCtx({ admin: true });

  await tagstudents(ctx);

  assert.equal(calls.reply[0][0], TEXT.emptyMembers);
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('tagstudents: admin with members tags everyone with mention links', async () => {
  const { tagstudents } = createHandlers({
    storage: makeStorage({ getMaster: async () => ({ members: [{ name: 'سارة', userId: '10' }] }) }),
  });
  const { ctx, calls } = makeCtx({ admin: true });

  await tagstudents(ctx);

  assert.equal(calls.replyWithMarkdown.length, 1);
  assert.match(calls.replyWithMarkdown[0][0], /tg:\/\/user\/10/);
});
