import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/groups.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

function groupsStorage(overrides = {}) {
  return makeStorage({
    getTrainingGroups: async () => [],
    saveTrainingGroups: async () => {},
    ...overrides,
  });
}

test('listtrainingstudents: non-admin is rejected', async () => {
  const { listtrainingstudents } = createHandlers({ storage: groupsStorage() });
  const { ctx, calls } = makeCtx();

  await listtrainingstudents(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('listtrainingstudents: invalid training group id is rejected', async () => {
  const { listtrainingstudents } = createHandlers({ storage: groupsStorage() });
  const { ctx, calls } = makeCtx({ admin: true, text: '/listtrainingstudents abc' });

  await listtrainingstudents(ctx);

  assert.equal(calls.reply[0][0], TEXT.invalidTrainingGroupId);
});

test('addtraininggroup: missing separator is rejected', async () => {
  const { addtraininggroup } = createHandlers({ storage: groupsStorage() });
  const { ctx, calls } = makeCtx({ admin: true, text: '/addtraininggroup -100 no separator' });

  await addtraininggroup(ctx);

  assert.equal(calls.reply[0][0], TEXT.invalidAddTrainingGroupFormat);
});

test('addtraininggroup: valid input persists a new training group', async () => {
  let saved = null;
  const { addtraininggroup } = createHandlers({
    storage: groupsStorage({
      getTrainingGroups: async () => [],
      saveTrainingGroups: async (_g, groups) => { saved = groups; },
    }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/addtraininggroup -100 | مجموعة أ' });

  await addtraininggroup(ctx);

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { groupId: '-100', name: 'مجموعة أ' });
  assert.equal(calls.replyWithMarkdown.length, 1);
});

test('addtraininggroup: links the training group to the main group', async () => {
  const parentCalls = [];
  const { addtraininggroup } = createHandlers({
    storage: groupsStorage({
      getTrainingGroups: async () => [],
      saveTrainingGroups: async () => {},
      setParentGroup: async (child, parent) => { parentCalls.push([child, parent]); },
    }),
  });
  const { ctx } = makeCtx({ admin: true, chatId: 123, text: '/addtraininggroup -100 | مجموعة أ' });

  await addtraininggroup(ctx);

  // Training group (-100) linked to the main group (123)
  assert.deepEqual(parentCalls, [['-100', '123']]);
});

test('removetraininggroup: unknown id reports not found', async () => {
  const { removetraininggroup } = createHandlers({
    storage: groupsStorage({ getTrainingGroups: async () => [] }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/removetraininggroup -100' });

  await removetraininggroup(ctx);

  assert.equal(calls.reply[0][0], TEXT.trainingGroupNotFound('-100'));
});

test('listtraininggroups: empty list is reported', async () => {
  const { listtraininggroups } = createHandlers({
    storage: groupsStorage({ getTrainingGroups: async () => [] }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/listtraininggroups' });

  await listtraininggroups(ctx);

  assert.equal(calls.reply[0][0], TEXT.trainingGroupsEmpty);
});
