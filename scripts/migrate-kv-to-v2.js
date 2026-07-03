import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const REQUIRED_V2_TABLES = [
  'groups',
  'group_settings',
  'members',
  'teachers',
  'pending_registrations',
  'sessions',
  'session_messages',
  'session_participants',
  'checkpoints',
  'checkpoint_confirmations',
  'member_progress',
  'group_progress',
  'await_prompts',
];

async function assertV2SchemaReady(db) {
  const missing = [];

  for (const table of REQUIRED_V2_TABLES) {
    const { error } = await db.from(table).select('*', { head: true, count: 'exact' }).limit(1);
    if (error) {
      const msg = String(error.message || '');
      if (msg.includes(`'public.${table}'`) || msg.includes(`relation \"${table}\" does not exist`)) {
        missing.push(table);
        continue;
      }
      throw error;
    }
  }

  if (missing.length) {
    throw new Error(
      `V2 schema is not ready. Missing tables: ${missing.join(', ')}. `
      + 'Run scripts/supabase_v2.sql in Supabase SQL Editor, then retry migration.'
    );
  }
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function parseArgs() {
  const shouldApply = process.argv.includes('--yes');
  const groupArg = process.argv.find((arg) => arg.startsWith('--group='));
  const groupFilter = groupArg ? groupArg.split('=')[1] : null;
  return { shouldApply, groupFilter };
}

async function fetchAllKvRows(db) {
  const rows = [];
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .from('kv')
      .select('key,value')
      .order('key', { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || !data.length) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function buildIndex(rows) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(String(row.key), row.value);
  }
  return byKey;
}

function discoverGroupIds(keys, groupFilter = null) {
  const groupIds = new Set();

  for (const key of keys) {
    const prefixed = key.match(/^(master|teachers|pendingregistrations|activity|current|sessions|pageprogress|grouprecitation|series):(.*)$/);
    if (prefixed) {
      groupIds.add(prefixed[2]);
      continue;
    }
    const awaitKey = key.match(/^await:([^:]+):/);
    if (awaitKey) groupIds.add(awaitKey[1]);
  }

  const list = [...groupIds].sort();
  return groupFilter ? list.filter((gid) => gid === groupFilter) : list;
}

async function upsertGroup(db, gid, kv) {
  const activity = kv.get(`activity:${gid}`);
  const series = kv.get(`series:${gid}`);

  const row = {
    telegram_chat_id: gid,
    current_series: Number.isInteger(series?.current) && series.current > 0 ? series.current : 1,
    last_activity_at: toIso(activity?.lastActivityAt || activity) || null,
  };

  const { data, error } = await db
    .from('groups')
    .upsert(row, { onConflict: 'telegram_chat_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureGroupSettings(db, groupId) {
  const { error } = await db
    .from('group_settings')
    .upsert({ group_id: groupId }, { onConflict: 'group_id' });
  if (error) throw error;
}

async function migrateMembers(db, groupId, gid, kv) {
  const master = kv.get(`master:${gid}`);
  const members = Array.isArray(master?.members) ? master.members : [];
  if (!members.length) return new Map();

  const payload = members
    .filter((m) => m?.userId && m?.name)
    .map((m) => ({
      group_id: groupId,
      telegram_user_id: String(m.userId),
      name: String(m.name),
      active: true,
    }));

  if (payload.length) {
    const { error } = await db
      .from('members')
      .upsert(payload, { onConflict: 'group_id,telegram_user_id' });
    if (error) throw error;
  }

  const { data, error } = await db
    .from('members')
    .select('id,name,telegram_user_id')
    .eq('group_id', groupId)
    .eq('active', true);
  if (error) throw error;

  const byName = new Map();
  for (const row of data || []) {
    if (!byName.has(row.name)) byName.set(row.name, row.id);
  }
  return byName;
}

async function migrateTeachers(db, groupId, gid, kv) {
  const teachers = kv.get(`teachers:${gid}`);
  const list = Array.isArray(teachers) ? teachers : [];
  if (!list.length) return;

  const payload = list
    .filter((t) => t?.userId && t?.name && t?.type)
    .map((t) => ({
      group_id: groupId,
      telegram_user_id: String(t.userId),
      name: String(t.name),
      teacher_type: String(t.type),
      active: true,
    }));

  if (!payload.length) return;
  const { error } = await db
    .from('teachers')
    .upsert(payload, { onConflict: 'group_id,telegram_user_id' });
  if (error) throw error;
}

async function migratePendingRegistrations(db, groupId, gid, kv) {
  const pending = kv.get(`pendingregistrations:${gid}`);
  const list = Array.isArray(pending) ? pending : [];

  const { error: clearError } = await db
    .from('pending_registrations')
    .delete()
    .eq('group_id', groupId)
    .eq('status', 'pending');
  if (clearError) throw clearError;

  if (!list.length) return;

  const payload = list
    .filter((row) => row?.userId && row?.name)
    .map((row) => ({
      group_id: groupId,
      telegram_user_id: String(row.userId),
      name: String(row.name),
      username: row.username ? String(row.username) : null,
      status: 'pending',
      submitted_at: toIso(row.submittedAt) || new Date().toISOString(),
    }));

  if (!payload.length) return;

  const { error } = await db.from('pending_registrations').insert(payload);
  if (error) throw error;
}

function collectParticipantNames(session) {
  const names = new Set();
  const sources = [
    session?.attendance,
    session?.called,
    session?.registrationTimes,
    session?.pages,
    session?.verses,
  ];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(source)) names.add(key);
  }
  return [...names];
}

function buildLegacySessionMeta(session, legacyKey) {
  return {
    legacy_key: legacyKey,
    original_type: session?.type || null,
    groupRecitation: Boolean(session?.groupRecitation),
    pageList: Boolean(session?.pageList),
    groupRecitationStartPage: session?.groupRecitationStartPage ?? null,
  };
}

async function ensureSession(db, groupId, sessionType, session, legacyKey, archived, defaultSeries = 1) {
  const startedAt = toIso(session?.startedAt) || new Date().toISOString();
  const endedAt = toIso(session?.endedAt);
  const payload = {
    group_id: groupId,
    session_type: sessionType,
    name: String(session?.name || 'جلسة'),
    series_id: Number.isInteger(session?.seriesId) && session.seriesId > 0 ? session.seriesId : defaultSeries,
    active: Boolean(session?.active) && !archived,
    registration_active: session?.registrationActive !== false,
    allow_public_registration: Boolean(session?.allowPublicRegistration),
    chat_id: String(session?.chatId || ''),
    widget_message_id: Number.isInteger(session?.messageId) ? session.messageId : null,
    started_at: startedAt,
    started_by: session?.startedBy ? String(session.startedBy) : null,
    ended_at: endedAt,
    ended_by: session?.endedBy ? String(session.endedBy) : null,
    archived: Boolean(archived),
    metadata: buildLegacySessionMeta(session, legacyKey),
  };

  const { data: existing, error: findError } = await db
    .from('sessions')
    .select('id')
    .eq('group_id', groupId)
    .contains('metadata', { legacy_key: legacyKey })
    .maybeSingle();
  if (findError) throw findError;

  let sessionId = existing?.id;
  if (!sessionId) {
    const { data: inserted, error: insertError } = await db
      .from('sessions')
      .insert(payload)
      .select('id')
      .single();
    if (insertError) throw insertError;
    sessionId = inserted.id;
  } else {
    const { error: updateError } = await db
      .from('sessions')
      .update(payload)
      .eq('id', sessionId);
    if (updateError) throw updateError;
  }

  return sessionId;
}

async function replaceSessionParticipants(db, sessionId, session, memberByName) {
  const { error: clearError } = await db
    .from('session_participants')
    .delete()
    .eq('session_id', sessionId);
  if (clearError) throw clearError;

  const names = collectParticipantNames(session);
  if (!names.length) return;

  const payload = names.map((name) => {
    const memberId = memberByName.get(name) || null;
    const attendance = session?.attendance?.[name] || null;
    const called = session?.called?.[name] || null;
    const registrationTime = toIso(session?.registrationTimes?.[name]) || null;
    const pageRaw = session?.pages?.[name];
    return {
      session_id: sessionId,
      member_id: memberId,
      guest_name: memberId ? null : String(name),
      display_name: String(name),
      attendance_status: attendance,
      called_state: called === 'clear' ? null : called,
      registration_time: registrationTime,
      pages: pageRaw === undefined || pageRaw === null ? null : String(pageRaw),
      verse: session?.verses?.[name] ? String(session.verses[name]) : null,
    };
  });

  const { error } = await db.from('session_participants').insert(payload);
  if (error) throw error;
}

async function replaceSessionMessages(db, sessionId, session) {
  const { error: clearError } = await db
    .from('session_messages')
    .delete()
    .eq('session_id', sessionId);
  if (clearError) throw clearError;

  const rows = [];
  const pushMsg = (id, kind) => {
    if (!Number.isInteger(id)) return;
    rows.push({ session_id: sessionId, message_id: id, message_kind: kind });
  };

  pushMsg(session?.messageId, 'widget');
  for (const id of Array.isArray(session?.listMessageIds) ? session.listMessageIds : []) pushMsg(id, 'list');
  for (const id of Array.isArray(session?.actionMessageIds) ? session.actionMessageIds : []) pushMsg(id, 'action');
  for (const cp of Array.isArray(session?.checkpoints) ? session.checkpoints : []) pushMsg(cp?.messageId, 'checkpoint');

  if (!rows.length) return;
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.session_id}:${row.message_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const { error } = await db
    .from('session_messages')
    .upsert(unique, { onConflict: 'session_id,message_id' });
  if (error) throw error;
}

async function replaceSessionCheckpoints(db, sessionId, session, memberByName) {
  const { error: clearError } = await db
    .from('checkpoints')
    .delete()
    .eq('session_id', sessionId);
  if (clearError) throw clearError;

  const checkpoints = Array.isArray(session?.checkpoints) ? session.checkpoints : [];
  if (!checkpoints.length) return;

  const ordered = [...checkpoints].sort((a, b) => {
    const left = Number.isInteger(a?.id) ? a.id : 0;
    const right = Number.isInteger(b?.id) ? b.id : 0;
    return left - right;
  });

  for (let i = 0; i < ordered.length; i += 1) {
    const cp = ordered[i];
    const seq = Number.isInteger(cp?.id) && cp.id > 0 ? cp.id : i + 1;
    const { data: inserted, error: cpError } = await db
      .from('checkpoints')
      .insert({
        session_id: sessionId,
        checkpoint_seq: seq,
        checkpoint_kind: cp?.kind === 'start' ? 'start' : 'reminder',
        message_id: Number.isInteger(cp?.messageId) ? cp.messageId : null,
        created_at: toIso(cp?.createdAt) || new Date().toISOString(),
      })
      .select('id')
      .single();
    if (cpError) throw cpError;

    const confirmations = cp?.confirmations && typeof cp.confirmations === 'object'
      ? Object.entries(cp.confirmations)
      : [];

    const rows = confirmations
      .map(([name, at]) => {
        const memberId = memberByName.get(name);
        if (!memberId) return null;
        return {
          checkpoint_id: inserted.id,
          member_id: memberId,
          confirmed_at: toIso(at) || new Date().toISOString(),
          source: 'button',
        };
      })
      .filter(Boolean);

    if (rows.length) {
      const { error: confError } = await db
        .from('checkpoint_confirmations')
        .upsert(rows, { onConflict: 'checkpoint_id,member_id' });
      if (confError) throw confError;
    }
  }
}

async function migrateSessionRecord(db, groupId, sessionType, session, legacyKey, archived, memberByName, defaultSeries) {
  const sessionId = await ensureSession(db, groupId, sessionType, session, legacyKey, archived, defaultSeries);
  await replaceSessionParticipants(db, sessionId, session, memberByName);
  await replaceSessionMessages(db, sessionId, session);
  await replaceSessionCheckpoints(db, sessionId, session, memberByName);
}

async function migrateSessions(db, groupId, gid, kv, memberByName) {
  const current = kv.get(`current:${gid}`) || {};
  const archived = kv.get(`sessions:${gid}`) || {};
  const defaultSeries = Number.isInteger(archived?._series) && archived._series > 0 ? archived._series : 1;
  const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];

  for (const type of types) {
    const currentSession = current[type];
    if (currentSession) {
      const legacyKey = `current:${gid}:${type}`;
      await migrateSessionRecord(db, groupId, type, currentSession, legacyKey, false, memberByName, defaultSeries);
    }

    const sessionList = Array.isArray(archived?.[type]?.sessions) ? archived[type].sessions : [];
    for (let i = 0; i < sessionList.length; i += 1) {
      const session = sessionList[i];
      const startedAt = toIso(session?.startedAt) || 'na';
      const legacyKey = `archive:${gid}:${type}:${i}:${startedAt}`;
      await migrateSessionRecord(db, groupId, type, session, legacyKey, true, memberByName, defaultSeries);
    }
  }
}

async function migrateProgress(db, groupId, gid, kv, memberByName) {
  const pageProgress = kv.get(`pageprogress:${gid}`);
  const progressMap = pageProgress && typeof pageProgress === 'object' ? pageProgress : {};

  const memberRows = [];
  for (const [name, pageValue] of Object.entries(progressMap)) {
    const memberId = memberByName.get(name);
    if (!memberId) continue;
    memberRows.push({
      group_id: groupId,
      member_id: memberId,
      mode: 'personalRecitation',
      page_value: pageValue === null || pageValue === undefined ? null : String(pageValue),
    });
  }

  if (memberRows.length) {
    const { error } = await db
      .from('member_progress')
      .upsert(memberRows, { onConflict: 'group_id,member_id,mode' });
    if (error) throw error;
  }

  const groupRec = kv.get(`grouprecitation:${gid}`);
  const nextPage = Number.isInteger(groupRec?.nextPage) && groupRec.nextPage > 0 ? groupRec.nextPage : 1;
  const { error: groupError } = await db
    .from('group_progress')
    .upsert({ group_id: groupId, mode: 'groupRecitation', next_page: nextPage }, { onConflict: 'group_id,mode' });
  if (groupError) throw groupError;
}

async function migrateAwaitPrompts(db, groupId, gid, kv) {
  const awaitEntries = [];
  for (const [key, value] of kv.entries()) {
    const m = key.match(/^await:([^:]+):(.*)$/);
    if (!m) continue;
    if (m[1] !== gid) continue;
    if (!value || typeof value !== 'object') continue;

    const uid = m[2];
    const payload = { ...value };
    delete payload.action;
    delete payload.chatId;
    delete payload.msgId;
    delete payload.promptMsgId;
    delete payload.awaitingPrompt;

    awaitEntries.push({
      group_id: groupId,
      telegram_user_id: uid,
      action: value.action ? String(value.action) : 'unknown',
      chat_id: value.chatId ? String(value.chatId) : String(gid),
      host_message_id: Number.isInteger(value.msgId) ? value.msgId : null,
      prompt_message_id: Number.isInteger(value.promptMsgId) ? value.promptMsgId : null,
      awaiting_prompt: Boolean(value.awaitingPrompt),
      payload,
    });
  }

  if (!awaitEntries.length) return;

  const { error } = await db
    .from('await_prompts')
    .upsert(awaitEntries, { onConflict: 'group_id,telegram_user_id' });
  if (error) throw error;
}

function estimateCounts(groupIds, kv) {
  const summary = {
    groups: groupIds.length,
    members: 0,
    teachers: 0,
    pendingRegistrations: 0,
    sessions: 0,
    awaitPrompts: 0,
  };

  for (const gid of groupIds) {
    const members = kv.get(`master:${gid}`)?.members;
    summary.members += Array.isArray(members) ? members.length : 0;

    const teachers = kv.get(`teachers:${gid}`);
    summary.teachers += Array.isArray(teachers) ? teachers.length : 0;

    const pending = kv.get(`pendingregistrations:${gid}`);
    summary.pendingRegistrations += Array.isArray(pending) ? pending.length : 0;

    const current = kv.get(`current:${gid}`) || {};
    summary.sessions += Object.keys(current).length;

    const archived = kv.get(`sessions:${gid}`) || {};
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    for (const type of types) {
      const list = archived?.[type]?.sessions;
      summary.sessions += Array.isArray(list) ? list.length : 0;
    }
  }

  for (const key of kv.keys()) {
    if (key.startsWith('await:')) summary.awaitPrompts += 1;
  }

  return summary;
}

async function migrateGroup(db, gid, kv) {
  const groupId = await upsertGroup(db, gid, kv);
  await ensureGroupSettings(db, groupId);
  const memberByName = await migrateMembers(db, groupId, gid, kv);
  await migrateTeachers(db, groupId, gid, kv);
  await migratePendingRegistrations(db, groupId, gid, kv);
  await migrateSessions(db, groupId, gid, kv, memberByName);
  await migrateProgress(db, groupId, gid, kv, memberByName);
  await migrateAwaitPrompts(db, groupId, gid, kv);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  const { shouldApply, groupFilter } = parseArgs();
  const db = createClient(url, key, { auth: { persistSession: false } });

  await assertV2SchemaReady(db);

  const rows = await fetchAllKvRows(db);
  const kv = buildIndex(rows);
  const groupIds = discoverGroupIds(kv.keys(), groupFilter);
  const counts = estimateCounts(groupIds, kv);

  console.log(`Found ${rows.length} kv rows.`);
  console.log(`Groups selected: ${groupIds.length}${groupFilter ? ` (filter=${groupFilter})` : ''}`);
  console.log(`Estimate -> members: ${counts.members}, teachers: ${counts.teachers}, pending: ${counts.pendingRegistrations}, sessions: ${counts.sessions}, await prompts: ${counts.awaitPrompts}`);

  if (!shouldApply) {
    console.log('Dry run only. To execute migration, run: npm run migrate-v2 -- --yes');
    console.log('Optional group scope: npm run migrate-v2 -- --yes --group=<telegram_chat_id>');
    return;
  }

  for (const gid of groupIds) {
    await migrateGroup(db, gid, kv);
    console.log(`Migrated group ${gid}`);
  }

  console.log('Migration completed successfully.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
