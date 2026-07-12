import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHandlers } from '../lib/handlers/actions/attendance.js';
import { TEXT, st } from '../lib/text.js';
import { makeCtx, makeStorage, makeTelegram } from './mocks.js';

test('refresh: non-admin (private chat) is rejected without touching storage', async () => {
  let saved = false;
  const storage = makeStorage({ saveSession: async () => { saved = true; } });
  const { refresh } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx({ chatType: 'private' });

  await refresh(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.adminOnly]]);
  assert.equal(saved, false);
});

test('mark: no active session answers noSessionActive', async () => {
  const storage = makeStorage({ getActiveSession: async () => null });
  const { mark } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await mark(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSessionActive]]);
});

test('mark: unregistered user on a roster list is queued as a pending registration', async () => {
  const savePendingCalls = [];
  let savedMaster = null;
  const session = { type: 'main', active: true, registrationActive: true, allowPublicRegistration: false, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'main', session }),
    getMaster: async () => ({ members: [] }),
    saveMaster: async (_g, master) => { savedMaster = master; },
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async (gid, pending) => { savePendingCalls.push([gid, pending]); },
  });
  const { mark } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' }, match: ['a:present', 'present'] });

  await mark(ctx);

  // Queued for approval, not added to the roster on the spot.
  assert.equal(savePendingCalls.length, 1);
  assert.equal(savePendingCalls[0][1][0].userId, '42');
  assert.equal(savePendingCalls[0][1][0].name, 'ليان');
  assert.equal(savedMaster, null);
});

test('mark: closed registration clears the keyboard and alerts', async () => {
  const storage = makeStorage({
    getActiveSession: async () => ({
      type: 'main',
      session: { type: 'main', active: true, registrationActive: false },
    }),
  });
  const { mark } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await mark(ctx);

  assert.equal(calls.editMessageReplyMarkup.length, 1);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.registrationClosedAlert]]);
});

test('recite: no active session answers noSessionActive', async () => {
  const storage = makeStorage({ getActiveSession: async () => null });
  const { recite } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await recite(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.noSessionActive]]);
});

test('recite: closed registration answers registrationClosedAlert', async () => {
  const session = { type: 'registeredSecondary', active: true, registrationActive: false, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
  });
  const { recite } = createHandlers({ storage, telegram: {} });
  const { ctx, calls } = makeCtx();

  await recite(ctx);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.registrationClosedAlert]]);
});

test('recite: unregistered student is registered present and queued for approval', async () => {
  const savePendingCalls = [];
  const session = { type: 'registeredSecondary', active: true, registrationActive: true, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [] }),
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async (gid, pending) => { savePendingCalls.push([gid, pending]); },
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx);

  // Queued for admin approval, deduped by userId.
  assert.equal(savePendingCalls.length, 1);
  assert.equal(savePendingCalls[0][1][0].userId, '42');
  assert.equal(savePendingCalls[0][1][0].name, 'ليان');
  // Counted present in the live session, with a registration timestamp for ordering.
  const record = session.participants['ليان'];
  assert.equal(record.status, 'present');
  assert.equal(record.memberId, '42');
  assert.equal(typeof record.registeredAt, 'number');
  assert.equal(record.attendedMain, true);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteAttestationAlert, { show_alert: true }]]);
});

test('recite (no main): unregistered student is flagged as not attending the main session', async () => {
  const savePendingCalls = [];
  const session = { type: 'registeredSecondary', active: true, registrationActive: true, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [] }),
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async (gid, pending) => { savePendingCalls.push([gid, pending]); },
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx, false);

  const record = session.participants['ليان'];
  assert.equal(record.status, 'present');
  assert.equal(record.attendedMain, false);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteAttestationNoMainAlert, { show_alert: true }]]);
});

test('recite: existing member is marked present without queueing', async () => {
  const savePendingCalls = [];
  const session = { type: 'registeredSecondary', active: true, registrationActive: true, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [{ userId: '42', name: 'ليان' }] }),
    savePendingRegistrations: async (gid, pending) => { savePendingCalls.push([gid, pending]); },
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx);

  assert.equal(savePendingCalls.length, 0);
  const record = session.participants['ليان'];
  assert.equal(record.status, 'present');
  assert.equal(record.memberId, '42');
  assert.equal(typeof record.registeredAt, 'number');
  assert.equal(record.attendedMain, true);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteAttestationAlert, { show_alert: true }]]);
});

test('recite (no main): existing member is marked present and flagged not attending main', async () => {
  const session = { type: 'registeredSecondary', active: true, registrationActive: true, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [{ userId: '42', name: 'ليان' }] }),
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx, false);

  const record = session.participants['ليان'];
  assert.equal(record.status, 'present');
  assert.equal(record.attendedMain, false);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteAttestationNoMainAlert, { show_alert: true }]]);
});

test('recite (backup): frozen list still registers a member on the reserve list', async () => {
  const session = { type: 'registeredSecondary', active: true, registrationActive: false, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [{ userId: '42', name: 'ليان' }] }),
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx, true, true);

  const record = session.participants['ليان'];
  assert.equal(record.status, 'present');
  assert.equal(record.attendedMain, true);
  assert.equal(record.backup, true);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteBackupAlert, { show_alert: true }]]);
});

test('recite (backup, no main): frozen list flags a new student as backup and not attending main', async () => {
  const savePendingCalls = [];
  const session = { type: 'registeredSecondary', active: true, registrationActive: false, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [] }),
    getPendingRegistrations: async () => [],
    savePendingRegistrations: async (gid, pending) => { savePendingCalls.push([gid, pending]); },
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx, false, true);

  assert.equal(savePendingCalls.length, 1);
  const record = session.participants['ليان'];
  assert.equal(record.status, 'present');
  assert.equal(record.attendedMain, false);
  assert.equal(record.backup, true);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteBackupNoMainAlert, { show_alert: true }]]);
});

test('recite (backup): a member already on the primary list is not demoted to reserve', async () => {
  const session = {
    type: 'registeredSecondary', active: true, registrationActive: false,
    participants: { 'ليان': { name: 'ليان', memberId: '42', status: 'present', called: null, registeredAt: 1000, attendedMain: true, backup: false } },
  };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
    getMaster: async () => ({ members: [{ userId: '42', name: 'ليان' }] }),
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx, true, true);

  const record = session.participants['ليان'];
  assert.equal(record.backup, false);
  assert.equal(record.registeredAt, 1000);
  assert.deepEqual(calls.answerCbQuery, [[TEXT.reciteBackupAlreadyRegisteredAlert, { show_alert: true }]]);
});

test('recite (non-backup): frozen list rejects a normal registration attempt', async () => {
  const session = { type: 'registeredSecondary', active: true, registrationActive: false, participants: {} };
  const storage = makeStorage({
    getActiveSession: async () => ({ type: 'registeredSecondary', session }),
  });
  const { recite } = createHandlers({ storage, telegram: makeTelegram(), refreshSessionWidget: async () => {} });
  const { ctx, calls } = makeCtx({ userId: 42, from: { id: 42, first_name: 'ليان' } });

  await recite(ctx, true, false);

  assert.deepEqual(calls.answerCbQuery, [[TEXT.registrationClosedAlert]]);
  assert.equal(session.participants['ليان'], undefined);
});
