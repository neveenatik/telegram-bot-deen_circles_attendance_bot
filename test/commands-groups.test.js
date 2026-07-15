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

test('addhomeworkgroup: non-admin is rejected', async () => {
  const { addhomeworkgroup } = createHandlers({ storage: groupsStorage() });
  const { ctx, calls } = makeCtx({ text: '/addhomeworkgroup -100' });

  await addhomeworkgroup(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('addhomeworkgroup: an invalid id is rejected', async () => {
  const { addhomeworkgroup } = createHandlers({ storage: groupsStorage() });
  const { ctx, calls } = makeCtx({ admin: true, text: '/addhomeworkgroup notanid' });

  await addhomeworkgroup(ctx);

  assert.equal(calls.reply[0][0], TEXT.invalidAddHomeworkGroupFormat);
});

test('addhomeworkgroup: a valid id links the homework group', async () => {
  const links = [];
  const { addhomeworkgroup } = createHandlers({
    storage: groupsStorage({ setHomeworkGroup: async (main, hw) => { links.push([main, hw]); } }),
  });
  const { ctx, calls } = makeCtx({ admin: true, chatId: 123, text: '/addhomeworkgroup -1009999' });

  await addhomeworkgroup(ctx);

  assert.deepEqual(links, [['123', '-1009999']]);
  assert.equal(calls.replyWithMarkdown.length, 1);
});

test('removehomeworkgroup: reports when nothing is linked', async () => {
  const { removehomeworkgroup } = createHandlers({
    storage: groupsStorage({ getHomeworkGroupId: async () => null }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/removehomeworkgroup' });

  await removehomeworkgroup(ctx);

  assert.equal(calls.reply[0][0], TEXT.noHomeworkGroupLinked);
});

test('removehomeworkgroup: clears an existing link', async () => {
  let cleared = 0;
  const { removehomeworkgroup } = createHandlers({
    storage: groupsStorage({ getHomeworkGroupId: async () => '-1009999', removeHomeworkGroup: async () => { cleared += 1; } }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/removehomeworkgroup' });

  await removehomeworkgroup(ctx);

  assert.equal(cleared, 1);
  assert.equal(calls.reply[0][0], TEXT.homeworkGroupRemoved);
});
