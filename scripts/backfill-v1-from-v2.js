import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function parseArgs() {
  const shouldApply = process.argv.includes('--yes');
  const groupArg = process.argv.find((arg) => arg.startsWith('--group='));
  const groupFilter = groupArg ? groupArg.split('=')[1] : null;
  return { shouldApply, groupFilter };
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
}

function toLegacySession(row) {
  const blob = row?.metadata?.session_blob;
  if (blob && typeof blob === 'object') {
    return {
      ...blob,
      type: blob.type || row.session_type,
      active: row.active,
      seriesId: row.series_id,
      startedAt: blob.startedAt || toIso(row.started_at, new Date().toISOString()),
      endedAt: blob.endedAt || toIso(row.ended_at, null),
      archived: row.archived,
    };
  }

  return {
    type: row.session_type,
    name: row.name,
    chatId: row.chat_id,
    messageId: row.widget_message_id || undefined,
    seriesId: row.series_id,
    active: row.active,
    startedAt: toIso(row.started_at, new Date().toISOString()),
    endedAt: toIso(row.ended_at, null),
    archived: row.archived,
    attendance: {},
    called: {},
    registrationTimes: {},
    pages: {},
    verses: {},
    actionMessageIds: [],
    listMessageIds: [],
    checkpoints: [],
  };
}

async function upsertKv(db, key, value) {
  const { error } = await db.from('kv').upsert({ key, value });
  if (error) throw error;
}

async function deleteAwaitKeys(db, gid) {
  const { error } = await db.from('kv').delete().like('key', `await:${gid}:%`);
  if (error) throw error;
}

async function loadBaseData(db, groupFilter = null) {
  let groupsQuery = db
    .from('groups')
    .select('id,telegram_chat_id,current_series,last_activity_at')
    .order('id', { ascending: true });

  if (groupFilter) {
    groupsQuery = groupsQuery.eq('telegram_chat_id', groupFilter);
  }

  const { data: groups, error: groupsError } = await groupsQuery;
  if (groupsError) throw groupsError;

  const groupIds = (groups || []).map((g) => g.id);
  if (!groupIds.length) {
    return {
      groups: [],
      members: [],
      teachers: [],
      pending: [],
      sessions: [],
      awaitPrompts: [],
      memberProgress: [],
      groupProgress: [],
      processedUpdates: [],
    };
  }

  const [
    membersRes,
    teachersRes,
    pendingRes,
    sessionsRes,
    awaitRes,
    memberProgressRes,
    groupProgressRes,
    processedUpdatesRes,
  ] = await Promise.all([
    db.from('members').select('group_id,telegram_user_id,name,active').in('group_id', groupIds),
    db.from('teachers').select('group_id,telegram_user_id,name,teacher_type,active').in('group_id', groupIds),
    db.from('pending_registrations').select('group_id,telegram_user_id,name,username,status,submitted_at').in('group_id', groupIds),
    db.from('sessions').select('group_id,session_type,name,series_id,active,chat_id,widget_message_id,started_at,ended_at,archived,metadata').in('group_id', groupIds),
    db.from('await_prompts').select('group_id,telegram_user_id,action,chat_id,host_message_id,prompt_message_id,awaiting_prompt,payload').in('group_id', groupIds),
    db.from('member_progress').select('group_id,page_value,members(name)').in('group_id', groupIds).eq('mode', 'personalRecitation'),
    db.from('group_progress').select('group_id,next_page').in('group_id', groupIds).eq('mode', 'groupRecitation'),
    db.from('processed_updates').select('update_id,status,received_at,updated_at,processed_at,retry_count,last_error').order('update_id', { ascending: true }),
  ]);

  for (const res of [membersRes, teachersRes, pendingRes, sessionsRes, awaitRes, memberProgressRes, groupProgressRes, processedUpdatesRes]) {
    if (res.error) throw res.error;
  }

  return {
    groups: groups || [],
    members: membersRes.data || [],
    teachers: teachersRes.data || [],
    pending: pendingRes.data || [],
    sessions: sessionsRes.data || [],
    awaitPrompts: awaitRes.data || [],
    memberProgress: memberProgressRes.data || [],
    groupProgress: groupProgressRes.data || [],
    processedUpdates: processedUpdatesRes.data || [],
  };
}

function summarize(data) {
  return {
    groups: data.groups.length,
    members: data.members.length,
    teachers: data.teachers.length,
    pending: data.pending.length,
    sessions: data.sessions.length,
    awaitPrompts: data.awaitPrompts.length,
    memberProgress: data.memberProgress.length,
    groupProgress: data.groupProgress.length,
    processedUpdates: data.processedUpdates.length,
  };
}

async function backfillGroup(db, group, data) {
  const gid = group.telegram_chat_id;
  const groupId = group.id;

  const members = data.members
    .filter((row) => row.group_id === groupId && row.active)
    .map((row) => ({ userId: row.telegram_user_id, name: row.name }));

  const teachers = data.teachers
    .filter((row) => row.group_id === groupId && row.active)
    .map((row) => ({ userId: row.telegram_user_id, name: row.name, type: row.teacher_type }));

  const pending = data.pending
    .filter((row) => row.group_id === groupId && row.status === 'pending')
    .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))
    .map((row) => ({
      userId: row.telegram_user_id,
      name: row.name,
      username: row.username || null,
      submittedAt: toIso(row.submitted_at, new Date().toISOString()),
    }));

  const sessions = data.sessions.filter((row) => row.group_id === groupId);
  const current = {};
  const archived = {
    _series: Number.isInteger(group.current_series) && group.current_series > 0 ? group.current_series : 1,
  };

  for (const type of ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation']) {
    const activeRow = sessions
      .filter((row) => row.session_type === type && row.active && !row.archived)
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
    if (activeRow) {
      current[type] = toLegacySession(activeRow);
    }

    const archivedRows = sessions
      .filter((row) => row.session_type === type && row.archived)
      .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
      .map((row) => toLegacySession(row));

    if (archivedRows.length) {
      archived[type] = { sessions: archivedRows };
    }
  }

  const progress = {};
  for (const row of data.memberProgress) {
    if (row.group_id !== groupId) continue;
    const name = row.members?.name;
    if (name) progress[name] = row.page_value;
  }

  const groupRecRow = data.groupProgress.find((row) => row.group_id === groupId);
  const groupRecitation = {
    nextPage: Number.isInteger(groupRecRow?.next_page) && groupRecRow.next_page > 0 ? groupRecRow.next_page : 1,
  };

  const awaits = data.awaitPrompts.filter((row) => row.group_id === groupId);

  await upsertKv(db, `master:${gid}`, { members });
  await upsertKv(db, `teachers:${gid}`, teachers);
  await upsertKv(db, `pendingregistrations:${gid}`, pending);
  await upsertKv(db, `current:${gid}`, current);
  await upsertKv(db, `sessions:${gid}`, archived);
  await upsertKv(db, `series:${gid}`, { current: archived._series });
  await upsertKv(db, `pageprogress:${gid}`, progress);
  await upsertKv(db, `grouprecitation:${gid}`, groupRecitation);
  await upsertKv(db, `activity:${gid}`, { lastActivityAt: toIso(group.last_activity_at, new Date().toISOString()) });

  await deleteAwaitKeys(db, gid);
  for (const row of awaits) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    await upsertKv(db, `await:${gid}:${row.telegram_user_id}`, {
      action: row.action,
      chatId: row.chat_id,
      msgId: row.host_message_id,
      promptMsgId: row.prompt_message_id,
      awaitingPrompt: Boolean(row.awaiting_prompt),
      ...payload,
    });
  }
}

async function backfillProcessedUpdates(db, rows) {
  for (const row of rows) {
    await upsertKv(db, `processedupdate:${row.update_id}`, {
      status: row.status,
      createdAt: toIso(row.received_at, new Date().toISOString()),
      updatedAt: toIso(row.updated_at, new Date().toISOString()),
      processedAt: toIso(row.processed_at, null),
      retryCount: Number.isInteger(row.retry_count) ? row.retry_count : 0,
      lastError: row.last_error || null,
    });
  }
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

  const data = await loadBaseData(db, groupFilter);
  const counts = summarize(data);

  console.log(`Groups selected: ${counts.groups}${groupFilter ? ` (filter=${groupFilter})` : ''}`);
  console.log(`V2 source counts -> members: ${counts.members}, teachers: ${counts.teachers}, pending: ${counts.pending}, sessions: ${counts.sessions}, awaits: ${counts.awaitPrompts}, processed_updates: ${counts.processedUpdates}`);

  if (!shouldApply) {
    console.log('Dry run only. To execute v1 backfill, run: npm run backfill-v1 -- --yes');
    console.log('Optional group scope: npm run backfill-v1 -- --yes --group=<telegram_chat_id>');
    return;
  }

  for (const group of data.groups) {
    await backfillGroup(db, group, data);
    console.log(`Backfilled group ${group.telegram_chat_id}`);
  }

  if (!groupFilter) {
    await backfillProcessedUpdates(db, data.processedUpdates);
    console.log(`Backfilled processed updates: ${data.processedUpdates.length}`);
  } else {
    console.log('Skipped processed updates backfill due to group filter (processed updates are global).');
  }

  console.log('V1 backfill from V2 completed successfully.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
