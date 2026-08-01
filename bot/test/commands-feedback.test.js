import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/commands/feedback.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeTelegram } from './mocks.js';

test('feedback: without FEEDBACK_GROUP_ID configured, replies not-configured', async () => {
  const prev = process.env.FEEDBACK_GROUP_ID;
  delete process.env.FEEDBACK_GROUP_ID;
  try {
    const { feedback } = createHandlers({ telegram: makeTelegram() });
    const { ctx, calls } = makeCtx({ text: '/feedback شكرا' });

    await feedback(ctx);

    assert.equal(calls.reply[0][0], TEXT.contactNotConfigured);
  } finally {
    if (prev !== undefined) process.env.FEEDBACK_GROUP_ID = prev;
  }
});

test('feedback: configured with an inline message forwards to the feedback group', async () => {
  const prev = process.env.FEEDBACK_GROUP_ID;
  process.env.FEEDBACK_GROUP_ID = '-9001';
  try {
    const telegram = makeTelegram();
    const { feedback } = createHandlers({ telegram });
    const { ctx } = makeCtx({ text: '/feedback رسالة سرية' });

    await feedback(ctx);

    assert.equal(telegram.calls.sendMessage.length, 1);
    assert.equal(telegram.calls.sendMessage[0][0], '-9001');
    assert.match(telegram.calls.sendMessage[0][1], /رسالة سرية/);
  } finally {
    if (prev === undefined) delete process.env.FEEDBACK_GROUP_ID;
    else process.env.FEEDBACK_GROUP_ID = prev;
  }
});

test('onText: passes through when the user has no pending feedback', async () => {
  const prev = process.env.FEEDBACK_GROUP_ID;
  process.env.FEEDBACK_GROUP_ID = '-9001';
  try {
    const { onText } = createHandlers({ telegram: makeTelegram() });
    const { ctx } = makeCtx({ text: 'random message' });
    let nextCalled = false;

    await onText(ctx, async () => { nextCalled = true; });

    assert.equal(nextCalled, true);
  } finally {
    if (prev === undefined) delete process.env.FEEDBACK_GROUP_ID;
    else process.env.FEEDBACK_GROUP_ID = prev;
  }
});
