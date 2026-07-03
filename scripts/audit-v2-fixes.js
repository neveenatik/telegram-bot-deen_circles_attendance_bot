import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function parseArgs() {
  const shouldApply = process.argv.includes('--yes');
  const staleArg = process.argv.find((arg) => arg.startsWith('--stale-ms='));
  const staleMs = staleArg ? Number(staleArg.split('=')[1]) : 120000;
  return {
    shouldApply,
    staleMs: Number.isFinite(staleMs) && staleMs > 0 ? staleMs : 120000,
  };
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

async function loadBaseData(db) {
  const [groupsRes, settingsRes, membersRes, sessionsRes, participantsRes, pendingRes, updatesRes] = await Promise.all([
    db.from('groups').select('id,telegram_chat_id'),
    db.from('group_settings').select('group_id'),
    db.from('members').select('id,group_id,name,active').eq('active', true),
    db.from('sessions').select('id,group_id,chat_id,active,ended_at,updated_at'),
    db.from('session_participants').select('id,session_id,member_id,guest_name,display_name'),
    db.from('pending_registrations').select('id,status,resolved_at,resolved_by').eq('status', 'pending'),
    db.from('processed_updates').select('update_id,status,updated_at,retry_count').eq('status', 'processing'),
  ]);

  for (const res of [groupsRes, settingsRes, membersRes, sessionsRes, participantsRes, pendingRes, updatesRes]) {
    if (res.error) throw res.error;
  }

  return {
    groups: groupsRes.data || [],
    settings: settingsRes.data || [],
    members: membersRes.data || [],
    sessions: sessionsRes.data || [],
    participants: participantsRes.data || [],
    pending: pendingRes.data || [],
    processingUpdates: updatesRes.data || [],
  };
}

function buildIndexes(base) {
  const settingsGroupIds = new Set(base.settings.map((r) => r.group_id));

  const memberIdByGroupAndName = new Map();
  for (const m of base.members) {
    memberIdByGroupAndName.set(`${m.group_id}:${m.name}`, m.id);
  }

  const sessionById = new Map();
  for (const s of base.sessions) {
    sessionById.set(s.id, s);
  }

  return {
    settingsGroupIds,
    memberIdByGroupAndName,
    sessionById,
  };
}

function analyze(base, idx, staleMs) {
  const now = Date.now();
  const report = {
    missingGroupSettings: [],
    sessionsWithBlankChatId: [],
    activeSessionsWithEndedAt: [],
    relinkableParticipants: [],
    pendingWithResolvedFields: [],
    staleProcessingUpdates: [],
  };

  for (const g of base.groups) {
    if (!idx.settingsGroupIds.has(g.id)) {
      report.missingGroupSettings.push({ group_id: g.id });
    }
  }

  for (const s of base.sessions) {
    if (isBlank(s.chat_id)) {
      report.sessionsWithBlankChatId.push({ id: s.id, chat_id: s.chat_id, group_id: s.group_id });
    }
    if (s.active && s.ended_at) {
      report.activeSessionsWithEndedAt.push({ id: s.id, ended_at: s.ended_at });
    }
  }

  for (const p of base.participants) {
    if (p.member_id) continue;
    const session = idx.sessionById.get(p.session_id);
    if (!session) continue;
    const memberId = idx.memberIdByGroupAndName.get(`${session.group_id}:${p.display_name}`);
    if (!memberId) continue;
    report.relinkableParticipants.push({
      id: p.id,
      session_id: p.session_id,
      member_id: memberId,
      guest_name: null,
    });
  }

  for (const p of base.pending) {
    if (p.resolved_at || p.resolved_by) {
      report.pendingWithResolvedFields.push({ id: p.id });
    }
  }

  for (const u of base.processingUpdates) {
    const updatedAt = Date.parse(u.updated_at);
    if (!Number.isFinite(updatedAt)) continue;
    if ((now - updatedAt) > staleMs) {
      report.staleProcessingUpdates.push({
        update_id: u.update_id,
        retry_count: Number.isInteger(u.retry_count) ? u.retry_count : 0,
      });
    }
  }

  return report;
}

function printReport(report) {
  console.log('Post-migration audit summary:');
  console.log(`- missing group_settings rows: ${report.missingGroupSettings.length}`);
  console.log(`- sessions with blank chat_id: ${report.sessionsWithBlankChatId.length}`);
  console.log(`- active sessions with ended_at set: ${report.activeSessionsWithEndedAt.length}`);
  console.log(`- relinkable participants: ${report.relinkableParticipants.length}`);
  console.log(`- pending rows with resolved fields: ${report.pendingWithResolvedFields.length}`);
  console.log(`- stale processing updates: ${report.staleProcessingUpdates.length}`);
}

async function applyFixes(db, report) {
  if (report.missingGroupSettings.length) {
    const { error } = await db
      .from('group_settings')
      .upsert(report.missingGroupSettings, { onConflict: 'group_id' });
    if (error) throw error;
  }

  for (const row of report.sessionsWithBlankChatId) {
    const { error } = await db
      .from('sessions')
      .update({ chat_id: String(row.group_id) })
      .eq('id', row.id);
    if (error) throw error;
  }

  if (report.activeSessionsWithEndedAt.length) {
    const ids = report.activeSessionsWithEndedAt.map((r) => r.id);
    const { error } = await db
      .from('sessions')
      .update({ ended_at: null })
      .in('id', ids);
    if (error) throw error;
  }

  for (const row of report.relinkableParticipants) {
    const { error } = await db
      .from('session_participants')
      .update({ member_id: row.member_id, guest_name: row.guest_name })
      .eq('id', row.id);
    if (error) throw error;
  }

  if (report.pendingWithResolvedFields.length) {
    const ids = report.pendingWithResolvedFields.map((r) => r.id);
    const { error } = await db
      .from('pending_registrations')
      .update({ resolved_at: null, resolved_by: null })
      .in('id', ids);
    if (error) throw error;
  }

  for (const row of report.staleProcessingUpdates) {
    const { error } = await db
      .from('processed_updates')
      .update({
        status: 'failed',
        last_error: 'auto-failed by post-migration audit: stale processing lock',
        retry_count: (row.retry_count || 0) + 1,
      })
      .eq('update_id', row.update_id)
      .eq('status', 'processing');
    if (error) throw error;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'audit_v2_missing_env',
      message: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.',
      at: new Date().toISOString(),
    }));
    process.exit(1);
  }

  const { shouldApply, staleMs } = parseArgs();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const base = await loadBaseData(db);
  const idx = buildIndexes(base);
  const report = analyze(base, idx, staleMs);

  printReport(report);

  if (!shouldApply) {
    console.log('Dry run only. Apply fixes with: npm run audit-v2:fix');
    console.log('Optional stale lock window: node scripts/audit-v2-fixes.js --yes --stale-ms=300000');
    return;
  }

  await applyFixes(db, report);
  console.log('Fixes applied. Re-running audit...');

  const baseAfter = await loadBaseData(db);
  const idxAfter = buildIndexes(baseAfter);
  const after = analyze(baseAfter, idxAfter, staleMs);
  printReport(after);
}

main().catch((err) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'audit_v2_unhandled_error',
    message: err?.message || String(err),
    at: new Date().toISOString(),
  }));
  process.exit(1);
});
