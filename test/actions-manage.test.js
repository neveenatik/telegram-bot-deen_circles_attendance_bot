import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/manage.js';
import { TEXT } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

function manageDeps(session, overrides = {}) {
  const calls = { saveParticipant: [], saveSession: [], refreshSession: 0, refreshManage: 0 };
  const storage = makeStorage({
    getSession: async () => session,
    getMaster: async () => ({ members: [{ name: 'سارة', userId: '1' }] }),
    saveSession: async (...a) => { calls.saveSession.push(a); },
    saveParticipant: async (...a) => { calls.saveParticipant.push(a); },
    ...overrides,
  });
  const handlers = createHandlers({
    storage,
    telegram: makeTelegram(),
    refreshSessionWidget: async () => { calls.refreshSession += 1; },
    refreshManageWidget: async () => { calls.refreshManage += 1; },
  });
  return { handlers, calls };
}

test('setStatus: non-admin is rejected', async () => {
  const { handlers } = manageDeps({ type: 'main', active: true, participants: {} });
  const { ctx, calls } = makeCtx({ match: ['sm:main:set:0:present', 'main', '0', 'present'] });

  await handlers.setStatus(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
});

test('setStatus: no active session answers noSessionShort', async () => {
  const { handlers } = manageDeps(null, { getSession: async () => null });
  const { ctx, calls } = makeCtx({ admin: true, match: ['sm:main:set:0:present', 'main', '0', 'present'] });

  await handlers.setStatus(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSessionShort]]);
});

test('setStatus: on a normal session persists a single participant (not full session)', async () => {
  const session = {
    type: 'main',
    active: true,
    participants: { 'سارة': { name: 'سارة', memberId: '1', status: null, called: null } },
  };
  const { handlers, calls } = manageDeps(session);
  const { ctx } = makeCtx({ admin: true, match: ['sm:main:set:0:present', 'main', '0', 'present'] });

  await handlers.setStatus(ctx);

  assert.equal(calls.saveParticipant.length, 1);
  assert.equal(calls.saveParticipant[0][3], 'سارة');
  assert.equal(calls.saveSession.length, 0);
  assert.equal(calls.refreshSession, 1);
  assert.equal(calls.refreshManage, 1);
});

test('setStatus: on a groupRecitation session persists the full session (page recalculation)', async () => {
  const session = {
    type: 'groupRecitation',
    active: true,
    groupRecitation: true,
    participants: { 'سارة': { name: 'سارة', memberId: '1', status: null, called: null } },
  };
  const { handlers, calls } = manageDeps(session);
  const { ctx } = makeCtx({ admin: true, match: ['sm:groupRecitation:set:0:listening', 'groupRecitation', '0', 'listening'] });

  await handlers.setStatus(ctx);

  assert.equal(calls.saveSession.length >= 1, true);
  assert.equal(calls.saveParticipant.length, 0);
});

test('setCall: persists a single participant and refreshes both widgets', async () => {
  const session = {
    type: 'training',
    active: true,
    participants: { 'سارة': { name: 'سارة', memberId: '1', status: 'present', called: null } },
  };
  const { handlers, calls } = manageDeps(session);
  const { ctx } = makeCtx({ admin: true, match: ['sm:training:call:0:responding', 'training', '0', 'responding'] });

  await handlers.setCall(ctx);

  assert.equal(calls.saveParticipant.length, 1);
  assert.equal(calls.refreshSession, 1);
  assert.equal(calls.refreshManage, 1);
});

function pickKeyboardData(calls) {
  const opts = calls.editMessageText[0][1];
  return opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
}

test('pick: a main session hides the call (نداء) buttons and header line', async () => {
  const session = {
    type: 'main',
    active: true,
    participants: { 'سارة': { name: 'سارة', memberId: '1', status: 'present', called: null } },
  };
  const { handlers } = manageDeps(session);
  const { ctx, calls } = makeCtx({ admin: true, match: ['sm:main:pick:0', 'main', '0'] });

  await handlers.pick(ctx);

  const data = pickKeyboardData(calls);
  assert.equal(data.some((d) => d.includes(':call:')), false, 'no call buttons for main');
  assert.equal(calls.editMessageText[0][0].includes('حالة النداء'), false, 'no call-status header for main');
});

test('pick: a training session shows the call (نداء) buttons and header line', async () => {
  const session = {
    type: 'training',
    active: true,
    participants: { 'سارة': { name: 'سارة', memberId: '1', status: 'present', called: null } },
  };
  const { handlers } = manageDeps(session);
  const { ctx, calls } = makeCtx({ admin: true, match: ['sm:training:pick:0', 'training', '0'] });

  await handlers.pick(ctx);

  const data = pickKeyboardData(calls);
  assert.equal(data.some((d) => d.includes(':call:')), true, 'call buttons present for training');
  assert.equal(calls.editMessageText[0][0].includes('حالة النداء'), true, 'call-status header present for training');
});

test('setStatus: unknown member index answers memberNotFound', async () => {
  const session = { type: 'main', active: true, participants: {} };
  const { handlers } = manageDeps(session, { getMaster: async () => ({ members: [] }) });
  const { ctx, calls } = makeCtx({ admin: true, match: ['sm:main:set:5:present', 'main', '5', 'present'] });

  await handlers.setStatus(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.memberNotFound]]);
});
