import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/members.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

function handlers(storage) {
  return createHandlers({ storage, telegram: makeTelegram() });
}

test('students: non-admin is rejected', async () => {
  const { students } = handlers(makeStorage());
  const { ctx, calls } = makeCtx();

  await students(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
  assert.equal(calls.replyWithMarkdown.length, 0);
});

test('students: admin gets the members list', async () => {
  const telegram = makeTelegram();
  const { students } = createHandlers({ storage: makeStorage({ getMaster: async () => ({ members: [] }) }), telegram });
  const { ctx, calls } = makeCtx({ admin: true });

  await students(ctx);

  // Panel is delivered to the admin's DM; the group only gets an ephemeral note.
  assert.equal(telegram.calls.sendMessage.length, 1);
  assert.equal(telegram.calls.sendMessage[0][0], ctx.from.id);
  assert.equal(calls.reply[0][0], TEXT.panelSentToDm);
});

test('removestudents: non-creator is rejected with creatorOnly', async () => {
  const { removestudents } = handlers(makeStorage());
  const { ctx, calls } = makeCtx({ admin: true }); // admin but not creator

  await removestudents(ctx);

  assert.equal(calls.reply[0][0], TEXT.creatorOnly);
});

test('removestudents: creator with no members reports nothing to remove', async () => {
  const { removestudents } = handlers(makeStorage({ getMaster: async () => ({ members: [] }) }));
  const { ctx, calls } = makeCtx({ creator: true });

  await removestudents(ctx);

  assert.equal(calls.reply[0][0], TEXT.noStudentsToRemove);
});

test('addstudent: admin with empty input reports invalid format', async () => {
  const { addstudent } = handlers(makeStorage());
  const { ctx, calls } = makeCtx({ admin: true, text: '/addstudent' });

  await addstudent(ctx);

  assert.equal(calls.reply[0][0], TEXT.invalidAddFormat);
});

test('addstudent: admin adds a single member and persists the master list', async () => {
  let savedMaster = null;
  const storage = makeStorage({
    getMaster: async () => ({ members: [] }),
    saveMaster: async (_g, master) => { savedMaster = master; },
    getActiveSession: async () => null,
  });
  const { addstudent } = handlers(storage);
  const { ctx, calls } = makeCtx({ admin: true, text: '/addstudent 555 | سارة' });

  await addstudent(ctx);

  assert.equal(savedMaster.members.length, 1);
  assert.deepEqual(savedMaster.members[0], { userId: '555', name: 'سارة' });
  // Single successful add => ephemeral confirmation via ctx.reply
  assert.equal(calls.reply[0][0], TEXT.memberAdded('سارة', '555'));
});

test('addstudent: rejects a malformed entry without saving', async () => {
  let saved = false;
  const storage = makeStorage({
    getMaster: async () => ({ members: [] }),
    saveMaster: async () => { saved = true; },
  });
  const { addstudent } = handlers(storage);
  const { ctx, calls } = makeCtx({ admin: true, text: '/addstudent notanumber | سارة' });

  await addstudent(ctx);

  assert.equal(saved, false);
  assert.equal(calls.replyWithMarkdown.length, 1);
});

test('removestudent: admin removing an existing member persists the master list', async () => {
  let savedMaster = null;
  const storage = makeStorage({
    getMaster: async () => ({ members: [{ userId: '1', name: 'سارة' }] }),
    saveMaster: async (_g, master) => { savedMaster = master; },
    getActiveSession: async () => null,
  });
  const { removestudent } = handlers(storage);
  const { ctx } = makeCtx({ admin: true, text: '/removestudent سارة' });

  await removestudent(ctx);

  assert.equal(savedMaster.members.length, 0);
});
