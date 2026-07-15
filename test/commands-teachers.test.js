import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/teachers.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage } from './mocks.js';

function teacherStorage(overrides = {}) {
  return makeStorage({
    getTeachers: async () => [],
    saveTeachers: async () => {},
    ...overrides,
  });
}

test('addteacher: non-admin is rejected', async () => {
  const { addteacher } = createHandlers({ storage: teacherStorage() });
  const { ctx, calls } = makeCtx();

  await addteacher(ctx);

  assert.equal(calls.reply[0][0], TEXT.adminOnly);
});

test('addteacher: admin with empty input reports invalid format', async () => {
  const { addteacher } = createHandlers({ storage: teacherStorage() });
  const { ctx, calls } = makeCtx({ admin: true, text: '/addteacher' });

  await addteacher(ctx);

  assert.equal(calls.reply[0][0], TEXT.invalidAddTeacherFormat);
});

test('addteacher: admin adds a valid teacher and persists', async () => {
  let saved = null;
  const { addteacher } = createHandlers({
    storage: teacherStorage({
      getTeachers: async () => [],
      saveTeachers: async (_g, teachers) => { saved = teachers; },
    }),
  });
  const { ctx, calls } = makeCtx({ admin: true, text: '/addteacher 777 | منى | courseteacher' });

  await addteacher(ctx);

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { userId: '777', name: 'منى', types: ['courseteacher'] });
  assert.equal(calls.replyWithMarkdown.length, 1);
});

test('addteacher: invalid teacher type is not persisted', async () => {
  let saved = false;
  const { addteacher } = createHandlers({
    storage: teacherStorage({ saveTeachers: async () => { saved = true; } }),
  });
  const { ctx } = makeCtx({ admin: true, text: '/addteacher 777 | منى | bogustype' });

  await addteacher(ctx);

  assert.equal(saved, false);
});

test('removeteacher: admin removing an existing teacher persists', async () => {
  let saved = null;
  const { removeteacher } = createHandlers({
    storage: teacherStorage({
      getTeachers: async () => [{ userId: '1', name: 'منى', types: ['courseteacher'] }],
      saveTeachers: async (_g, teachers) => { saved = teachers; },
    }),
  });
  const { ctx } = makeCtx({ admin: true, text: '/removeteacher منى' });

  await removeteacher(ctx);

  assert.equal(saved.length, 0);
});
