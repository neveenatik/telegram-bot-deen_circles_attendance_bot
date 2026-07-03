import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Local file backend (dev / fallback) ──────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const MASTER_FILE                  = path.join(DATA_DIR, 'masterList.json');
const SESSIONS_FILE                = path.join(DATA_DIR, 'sessions.json');
const CURRENT_FILE                 = path.join(DATA_DIR, 'currentSession.json');
const AWAIT_FILE                   = path.join(DATA_DIR, 'awaiting.json');
const PAGE_PROGRESS_FILE           = path.join(DATA_DIR, 'pageProgress.json');
const GROUP_RECITATION_FILE        = path.join(DATA_DIR, 'groupRecitation.json');
const TEACHERS_FILE                = path.join(DATA_DIR, 'teachers.json');
const ACTIVITY_FILE                = path.join(DATA_DIR, 'groupActivity.json');
const PENDING_REG_FILE             = path.join(DATA_DIR, 'pendingRegistrations.json');
const PROCESSED_UPDATES_FILE       = path.join(DATA_DIR, 'processedUpdates.json');
const ACTIVE_SESSION_TYPES         = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];

const readJSON  = (f)    => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

const normalizeGroupId = (groupId) => {
  if (groupId === undefined || groupId === null || groupId === '') {
    throw new Error('groupId is required for storage operations');
  }
  return String(groupId);
};

const readMap = (file) => {
  const data = readJSON(file);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

const deleteGroupFromFileMap = (file, groupId) => {
  const gid = normalizeGroupId(groupId);
  const all = readMap(file);
  if (gid in all) {
    delete all[gid];
    writeJSON(file, all);
  }
};

function normalizeUpdateId(updateId) {
  if (!Number.isInteger(updateId) || updateId < 0) {
    throw new Error('updateId must be a non-negative integer');
  }
  return String(updateId);
}

function nowIso() {
  return new Date().toISOString();
}

const fileBackend = {
  getMaster:      async (groupId)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(MASTER_FILE);
    return all[gid] || { members: [] };
  },
  saveMaster:     async (groupId, d) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(MASTER_FILE);
    all[gid] = d;
    writeJSON(MASTER_FILE, all);
  },
  getSession:     async (groupId, type)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    return byGroup[type] || null;
  },
  getActiveSession: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    for (const type of ACTIVE_SESSION_TYPES) {
      const session = byGroup[type] || null;
      if (session?.active) return { type, session };
    }
    return null;
  },
  saveSession:    async (groupId, type, s) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    byGroup[type] = s;
    all[gid] = byGroup;
    writeJSON(CURRENT_FILE, all);
  },
  clearSession:   async (groupId, type)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    delete byGroup[type];
    all[gid] = byGroup;
    writeJSON(CURRENT_FILE, all);
  },
  getSessions:    async (groupId, type)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : { sessions: [] };
    return Array.isArray(byType.sessions) ? byType.sessions : [];
  },
  saveSessions:   async (groupId, type, sessions) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : { sessions: [] };
    byType.sessions = Array.isArray(sessions) ? sessions : [];
    byGroup[type] = byType;
    all[gid] = byGroup;
    writeJSON(SESSIONS_FILE, all);
  },
  archiveSession: async (groupId, type, s) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : { sessions: [] };
    if (!Array.isArray(byType.sessions)) byType.sessions = [];
    byType.sessions.push(s);
    byGroup[type] = byType;
    all[gid] = byGroup;
    writeJSON(SESSIONS_FILE, all);
  },
  getAwaiting:    async (groupId, uid)    => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(AWAIT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    return byGroup[uid] || null;
  },
  setAwaiting:    async (groupId, uid, v) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(AWAIT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    byGroup[uid] = v;
    all[gid] = byGroup;
    writeJSON(AWAIT_FILE, all);
  },
  delAwaiting:    async (groupId, uid)    => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(AWAIT_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    delete byGroup[uid];
    all[gid] = byGroup;
    writeJSON(AWAIT_FILE, all);
  },
  getPageProgress: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(PAGE_PROGRESS_FILE);
    return all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
  },
  savePageProgress: async (groupId, data) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(PAGE_PROGRESS_FILE);
    all[gid] = data;
    writeJSON(PAGE_PROGRESS_FILE, all);
  },
  getGroupRecitationNextPage: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(GROUP_RECITATION_FILE);
    return (all[gid] && typeof all[gid] === 'object' ? all[gid].nextPage : null) || 1;
  },
  saveGroupRecitationNextPage: async (groupId, nextPage) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(GROUP_RECITATION_FILE);
    if (!all[gid]) all[gid] = {};
    all[gid].nextPage = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 1;
    writeJSON(GROUP_RECITATION_FILE, all);
  },
  getCurrentSeries: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    const s = byGroup._series;
    return Number.isInteger(s) && s > 0 ? s : 1;
  },
  saveCurrentSeries: async (groupId, series) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    byGroup._series = Number.isInteger(series) && series > 0 ? series : 1;
    all[gid] = byGroup;
    writeJSON(SESSIONS_FILE, all);
  },
  getAllSessions: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const byGroup = all[gid] && typeof all[gid] === 'object' ? all[gid] : {};
    const result = [];
    for (const type of ACTIVE_SESSION_TYPES) {
      const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : {};
      if (Array.isArray(byType.sessions)) result.push(...byType.sessions);
    }
    return result.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  },
  getTeachers: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(TEACHERS_FILE);
    return all[gid] && Array.isArray(all[gid]) ? all[gid] : [];
  },
  saveTeachers: async (groupId, teachers) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(TEACHERS_FILE);
    all[gid] = Array.isArray(teachers) ? teachers : [];
    writeJSON(TEACHERS_FILE, all);
  },
  getPendingRegistrations: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(PENDING_REG_FILE);
    return all[gid] && Array.isArray(all[gid]) ? all[gid] : [];
  },
  savePendingRegistrations: async (groupId, registrations) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(PENDING_REG_FILE);
    all[gid] = Array.isArray(registrations) ? registrations : [];
    writeJSON(PENDING_REG_FILE, all);
  },
  beginUpdateProcessing: async (updateId, staleMs = 120000) => {
    const id = normalizeUpdateId(updateId);
    const all = readMap(PROCESSED_UPDATES_FILE);
    const existing = all[id];
    const now = nowIso();

    if (!existing) {
      all[id] = {
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        processedAt: null,
        retryCount: 0,
        lastError: null,
      };
      writeJSON(PROCESSED_UPDATES_FILE, all);
      return { shouldProcess: true, reason: 'new' };
    }

    if (existing.status === 'processed') {
      return { shouldProcess: false, reason: 'processed' };
    }

    const existingTs = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
    const isFreshProcessing = existing.status === 'processing' && Number.isFinite(existingTs)
      && (Date.now() - existingTs) < staleMs;
    if (isFreshProcessing) {
      return { shouldProcess: false, reason: 'in_progress' };
    }

    all[id] = {
      ...existing,
      status: 'processing',
      updatedAt: now,
      retryCount: Number(existing.retryCount || 0) + 1,
    };
    writeJSON(PROCESSED_UPDATES_FILE, all);
    return { shouldProcess: true, reason: 'retry' };
  },
  completeUpdateProcessing: async (updateId) => {
    const id = normalizeUpdateId(updateId);
    const all = readMap(PROCESSED_UPDATES_FILE);
    const now = nowIso();
    const existing = all[id] || { createdAt: now, retryCount: 0 };
    all[id] = {
      ...existing,
      status: 'processed',
      updatedAt: now,
      processedAt: now,
      lastError: null,
    };
    writeJSON(PROCESSED_UPDATES_FILE, all);
  },
  failUpdateProcessing: async (updateId, errorMessage) => {
    const id = normalizeUpdateId(updateId);
    const all = readMap(PROCESSED_UPDATES_FILE);
    const now = nowIso();
    const existing = all[id] || { createdAt: now, retryCount: 0 };
    all[id] = {
      ...existing,
      status: 'failed',
      updatedAt: now,
      lastError: String(errorMessage || 'unknown error').slice(0, 1000),
    };
    writeJSON(PROCESSED_UPDATES_FILE, all);
  },
  touchGroupActivity: async (groupId, at = new Date().toISOString()) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(ACTIVITY_FILE);
    all[gid] = at;
    writeJSON(ACTIVITY_FILE, all);
  },
  listInactiveGroups: async (beforeIso) => {
    const cutoff = new Date(beforeIso).getTime();
    const all = readMap(ACTIVITY_FILE);
    return Object.entries(all)
      .filter(([, at]) => Number.isFinite(new Date(at).getTime()) && new Date(at).getTime() < cutoff)
      .map(([groupId, lastActivityAt]) => ({ groupId, lastActivityAt }))
      .sort((a, b) => new Date(a.lastActivityAt) - new Date(b.lastActivityAt));
  },
  clearGroupData: async (groupId) => {
    deleteGroupFromFileMap(MASTER_FILE, groupId);
    deleteGroupFromFileMap(SESSIONS_FILE, groupId);
    deleteGroupFromFileMap(CURRENT_FILE, groupId);
    deleteGroupFromFileMap(AWAIT_FILE, groupId);
    deleteGroupFromFileMap(PAGE_PROGRESS_FILE, groupId);
    deleteGroupFromFileMap(GROUP_RECITATION_FILE, groupId);
    deleteGroupFromFileMap(TEACHERS_FILE, groupId);
    deleteGroupFromFileMap(ACTIVITY_FILE, groupId);
    deleteGroupFromFileMap(PENDING_REG_FILE, groupId);
  },
};

// ─── Supabase backend (production) ─────────────────────────────────────────────
// Table:  kv ( key text primary key, value jsonb )
async function supabaseBackend() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const findGroupRowId = async (gid) => {
    const { data, error } = await db
      .from('groups')
      .select('id')
      .eq('telegram_chat_id', gid)
      .maybeSingle();
    if (error) throw error;
    return data?.id || null;
  };

  const ensureGroupRowId = async (gid) => {
    const { data, error } = await db
      .from('groups')
      .upsert({ telegram_chat_id: gid }, { onConflict: 'telegram_chat_id' })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  };

  const parseIso = (value, fallback = null) => {
    if (!value) return fallback;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
  };

  const toLegacySessionBlob = (row) => {
    const blob = row?.metadata?.session_blob;
    if (blob && typeof blob === 'object') {
      return {
        ...blob,
        type: blob.type || row.session_type,
        active: row.active,
        seriesId: row.series_id,
        startedAt: blob.startedAt || parseIso(row.started_at, nowIso()),
        endedAt: blob.endedAt || parseIso(row.ended_at, null),
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
      startedAt: parseIso(row.started_at, nowIso()),
      endedAt: parseIso(row.ended_at, null),
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
  };

  const upsertSessionRow = async (gid, type, session, archived = false) => {
    const groupRowId = await ensureGroupRowId(gid);
    const metadata = {
      session_blob: session && typeof session === 'object' ? session : {},
    };

    const payload = {
      group_id: groupRowId,
      session_type: String(type),
      name: String(session?.name || 'جلسة'),
      series_id: Number.isInteger(session?.seriesId) && session.seriesId > 0 ? session.seriesId : 1,
      active: Boolean(session?.active) && !archived,
      registration_active: session?.registrationActive !== false,
      allow_public_registration: Boolean(session?.allowPublicRegistration),
      chat_id: String(session?.chatId || gid),
      widget_message_id: Number.isInteger(session?.messageId) ? session.messageId : null,
      started_at: parseIso(session?.startedAt, nowIso()),
      started_by: session?.startedBy ? String(session.startedBy) : null,
      ended_at: parseIso(session?.endedAt, null),
      ended_by: session?.endedBy ? String(session.endedBy) : null,
      archived: Boolean(archived),
      metadata,
    };

    const legacyKey = archived
      ? `archive-live:${gid}:${type}:${payload.started_at}`
      : `current:${gid}:${type}`;
    payload.metadata.legacy_key = legacyKey;

    const { data: existing, error: findError } = await db
      .from('sessions')
      .select('id')
      .eq('group_id', groupRowId)
      .contains('metadata', { legacy_key: legacyKey })
      .maybeSingle();
    if (findError) throw findError;

    if (existing?.id) {
      const { error: updateError } = await db
        .from('sessions')
        .update(payload)
        .eq('id', existing.id);
      if (updateError) throw updateError;
      return existing.id;
    }

    const { data: inserted, error: insertError } = await db
      .from('sessions')
      .insert(payload)
      .select('id')
      .single();
    if (insertError) throw insertError;
    return inserted.id;
  };

  return {
    getMaster:      async (groupId)  => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return { members: [] };

      const { data, error } = await db
        .from('members')
        .select('telegram_user_id,name')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return {
        members: (data || []).map((row) => ({
          userId: row.telegram_user_id,
          name: row.name,
        })),
      };
    },
    saveMaster:     async (groupId, d) => {
      const gid = normalizeGroupId(groupId);
      const next = d && typeof d === 'object' ? d : { members: [] };
      const list = Array.isArray(next.members) ? next.members : [];

      // Keep latest entry per Telegram user to avoid duplicate upserts.
      const byUser = new Map();
      for (const row of list) {
        if (!row?.userId || !row?.name) continue;
        byUser.set(String(row.userId), {
          group_id: null,
          telegram_user_id: String(row.userId),
          name: String(row.name),
          active: true,
        });
      }

      const groupRowId = await ensureGroupRowId(gid);
      const payload = [...byUser.values()].map((row) => ({ ...row, group_id: groupRowId }));

      if (payload.length) {
        const { error: upsertError } = await db
          .from('members')
          .upsert(payload, { onConflict: 'group_id,telegram_user_id' });
        if (upsertError) throw upsertError;
      }

      const activeIds = payload.map((row) => row.telegram_user_id);
      if (activeIds.length) {
        const { data: currentlyActive, error: activeReadError } = await db
          .from('members')
          .select('telegram_user_id')
          .eq('group_id', groupRowId)
          .eq('active', true);
        if (activeReadError) throw activeReadError;

        const keepSet = new Set(activeIds);
        const toDeactivate = (currentlyActive || [])
          .map((row) => row.telegram_user_id)
          .filter((id) => !keepSet.has(id));

        if (toDeactivate.length) {
          const { error: deactivateError } = await db
            .from('members')
            .update({ active: false })
            .eq('group_id', groupRowId)
            .eq('active', true)
            .in('telegram_user_id', toDeactivate);
          if (deactivateError) throw deactivateError;
        }
      } else {
        const { error: clearError } = await db
          .from('members')
          .update({ active: false })
          .eq('group_id', groupRowId)
          .eq('active', true);
        if (clearError) throw clearError;
      }

    },
    getSession:     async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('sessions')
        .select('session_type,name,series_id,active,chat_id,widget_message_id,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('session_type', type)
        .eq('active', true)
        .eq('archived', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      return data ? toLegacySessionBlob(data) : null;
    },
    getActiveSession: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('sessions')
        .select('session_type,name,series_id,active,chat_id,widget_message_id,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .eq('archived', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return { type: data.session_type, session: toLegacySessionBlob(data) };
    },
    saveSession:    async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      await upsertSessionRow(gid, type, s, false);

    },
    clearSession:   async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (groupRowId) {
        const { error } = await db
          .from('sessions')
          .update({ active: false, ended_at: nowIso() })
          .eq('group_id', groupRowId)
          .eq('session_type', type)
          .eq('active', true)
          .eq('archived', false);
        if (error) throw error;
      }

    },
    getSessions:    async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('sessions')
        .select('session_type,name,series_id,active,chat_id,widget_message_id,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('session_type', type)
        .eq('archived', true)
        .order('started_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => toLegacySessionBlob(row));
    },
    saveSessions:   async (groupId, type, sessions) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const next = Array.isArray(sessions) ? sessions : [];

      const { error: clearError } = await db
        .from('sessions')
        .delete()
        .eq('group_id', groupRowId)
        .eq('session_type', type)
        .eq('archived', true);
      if (clearError) throw clearError;

      for (const session of next) {
        await upsertSessionRow(gid, type, { ...session, active: false }, true);
      }

    },
    archiveSession: async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      await upsertSessionRow(gid, type, { ...s, active: false }, true);

    },
    getAwaiting:    async (groupId, uid)    => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('await_prompts')
        .select('action,chat_id,host_message_id,prompt_message_id,awaiting_prompt,payload')
        .eq('group_id', groupRowId)
        .eq('telegram_user_id', String(uid))
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return {
        action: data.action,
        chatId: data.chat_id,
        msgId: data.host_message_id,
        promptMsgId: data.prompt_message_id,
        awaitingPrompt: Boolean(data.awaiting_prompt),
        ...(data.payload && typeof data.payload === 'object' ? data.payload : {}),
      };
    },
    setAwaiting:    async (groupId, uid, v) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const payload = v && typeof v === 'object' ? { ...v } : {};
      const row = {
        group_id: groupRowId,
        telegram_user_id: String(uid),
        action: payload.action ? String(payload.action) : 'unknown',
        chat_id: payload.chatId ? String(payload.chatId) : gid,
        host_message_id: Number.isInteger(payload.msgId) ? payload.msgId : null,
        prompt_message_id: Number.isInteger(payload.promptMsgId) ? payload.promptMsgId : null,
        awaiting_prompt: Boolean(payload.awaitingPrompt),
        payload: {
          ...payload,
          action: undefined,
          chatId: undefined,
          msgId: undefined,
          promptMsgId: undefined,
          awaitingPrompt: undefined,
        },
      };
      await db.from('await_prompts').upsert(row, { onConflict: 'group_id,telegram_user_id' });
    },
    delAwaiting:    async (groupId, uid)    => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (groupRowId) {
        const { error } = await db
          .from('await_prompts')
          .delete()
          .eq('group_id', groupRowId)
          .eq('telegram_user_id', String(uid));
        if (error) throw error;
      }
    },
    getPageProgress: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return {};

      const { data, error } = await db
        .from('member_progress')
        .select('page_value,members(name)')
        .eq('group_id', groupRowId)
        .eq('mode', 'personalRecitation');
      if (error) throw error;

      const map = {};
      for (const row of data || []) {
        const name = row.members?.name;
        if (name) map[name] = row.page_value;
      }
      return map;
    },
    savePageProgress: async (groupId, data) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const next = data && typeof data === 'object' ? data : {};

      const { data: memberRows, error: membersError } = await db
        .from('members')
        .select('id,name')
        .eq('group_id', groupRowId)
        .eq('active', true);
      if (membersError) throw membersError;
      const byName = new Map((memberRows || []).map((m) => [m.name, m.id]));

      const { error: clearError } = await db
        .from('member_progress')
        .delete()
        .eq('group_id', groupRowId)
        .eq('mode', 'personalRecitation');
      if (clearError) throw clearError;

      const payload = Object.entries(next)
        .map(([name, pageValue]) => {
          const memberId = byName.get(name);
          if (!memberId) return null;
          return {
            group_id: groupRowId,
            member_id: memberId,
            mode: 'personalRecitation',
            page_value: pageValue === null || pageValue === undefined ? null : String(pageValue),
          };
        })
        .filter(Boolean);

      if (payload.length) {
        const { error: insertError } = await db
          .from('member_progress')
          .insert(payload);
        if (insertError) throw insertError;
      }

    },
    getGroupRecitationNextPage: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return 1;

      const { data, error } = await db
        .from('group_progress')
        .select('next_page')
        .eq('group_id', groupRowId)
        .eq('mode', 'groupRecitation')
        .maybeSingle();
      if (error) throw error;
      return Number.isInteger(data?.next_page) && data.next_page > 0 ? data.next_page : 1;
    },
    saveGroupRecitationNextPage: async (groupId, nextPage) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const next = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 1;
      const { error } = await db
        .from('group_progress')
        .upsert({
          group_id: groupRowId,
          mode: 'groupRecitation',
          next_page: next,
        }, { onConflict: 'group_id,mode' });
      if (error) throw error;

    },
    getCurrentSeries: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return 1;
      const { data, error } = await db
        .from('groups')
        .select('current_series')
        .eq('id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      return Number.isInteger(data?.current_series) && data.current_series > 0 ? data.current_series : 1;
    },
    saveCurrentSeries: async (groupId, series) => {
      const gid = normalizeGroupId(groupId);
      const s = Number.isInteger(series) && series > 0 ? series : 1;
      const groupRowId = await ensureGroupRowId(gid);
      const { error } = await db
        .from('groups')
        .update({ current_series: s })
        .eq('id', groupRowId);
      if (error) throw error;

    },
    getAllSessions: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('sessions')
        .select('session_type,name,series_id,active,chat_id,widget_message_id,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('archived', true)
        .order('started_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => toLegacySessionBlob(row));
    },
    getTeachers: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('teachers')
        .select('telegram_user_id,name,teacher_type')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => ({
        userId: row.telegram_user_id,
        name: row.name,
        type: row.teacher_type,
      }));
    },
    saveTeachers: async (groupId, teachers) => {
      const gid = normalizeGroupId(groupId);
      const next = Array.isArray(teachers) ? teachers : [];

      const byUser = new Map();
      for (const row of next) {
        if (!row?.userId || !row?.name || !row?.type) continue;
        byUser.set(String(row.userId), {
          group_id: null,
          telegram_user_id: String(row.userId),
          name: String(row.name),
          teacher_type: String(row.type),
          active: true,
        });
      }

      const groupRowId = await ensureGroupRowId(gid);
      const payload = [...byUser.values()].map((row) => ({ ...row, group_id: groupRowId }));

      if (payload.length) {
        const { error: upsertError } = await db
          .from('teachers')
          .upsert(payload, { onConflict: 'group_id,telegram_user_id' });
        if (upsertError) throw upsertError;
      }

      const activeIds = payload.map((row) => row.telegram_user_id);
      if (activeIds.length) {
        const { data: currentlyActive, error: activeReadError } = await db
          .from('teachers')
          .select('telegram_user_id')
          .eq('group_id', groupRowId)
          .eq('active', true);
        if (activeReadError) throw activeReadError;

        const keepSet = new Set(activeIds);
        const toDeactivate = (currentlyActive || [])
          .map((row) => row.telegram_user_id)
          .filter((id) => !keepSet.has(id));

        if (toDeactivate.length) {
          const { error: deactivateError } = await db
            .from('teachers')
            .update({ active: false })
            .eq('group_id', groupRowId)
            .eq('active', true)
            .in('telegram_user_id', toDeactivate);
          if (deactivateError) throw deactivateError;
        }
      } else {
        const { error: clearError } = await db
          .from('teachers')
          .update({ active: false })
          .eq('group_id', groupRowId)
          .eq('active', true);
        if (clearError) throw clearError;
      }

    },
    getPendingRegistrations: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('pending_registrations')
        .select('telegram_user_id,name,username,submitted_at')
        .eq('group_id', groupRowId)
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => ({
        userId: row.telegram_user_id,
        name: row.name,
        username: row.username || null,
        submittedAt: row.submitted_at || null,
      }));
    },
    savePendingRegistrations: async (groupId, registrations) => {
      const gid = normalizeGroupId(groupId);
      const next = Array.isArray(registrations) ? registrations : [];
      const groupRowId = await ensureGroupRowId(gid);

      const { error: clearError } = await db
        .from('pending_registrations')
        .delete()
        .eq('group_id', groupRowId)
        .eq('status', 'pending');
      if (clearError) throw clearError;

      if (next.length) {
        const payload = next
          .filter((row) => row?.userId && row?.name)
          .map((row) => ({
            group_id: groupRowId,
            telegram_user_id: String(row.userId),
            name: String(row.name),
            username: row.username ? String(row.username) : null,
            status: 'pending',
            submitted_at: row.submittedAt ? new Date(row.submittedAt).toISOString() : nowIso(),
          }));

        if (payload.length) {
          const { error: insertError } = await db
            .from('pending_registrations')
            .insert(payload);
          if (insertError) throw insertError;
        }
      }

    },
    beginUpdateProcessing: async (updateId, staleMs = 120000) => {
      const id = normalizeUpdateId(updateId);
      const now = nowIso();
      const { error: insertError } = await db
        .from('processed_updates')
        .insert({
          update_id: Number(id),
          status: 'processing',
          received_at: now,
          updated_at: now,
          processed_at: null,
          retry_count: 0,
          last_error: null,
        });

      if (!insertError) {
        return { shouldProcess: true, reason: 'new' };
      }

      if (insertError?.code !== '23505') {
        throw insertError;
      }

      const { data: existing, error: readError } = await db
        .from('processed_updates')
        .select('status,received_at,updated_at,retry_count,last_error')
        .eq('update_id', Number(id))
        .maybeSingle();
      if (readError) throw readError;
      if (!existing) throw new Error(`processed_updates row missing for update_id ${id}`);
      if (existing.status === 'processed') {
        return { shouldProcess: false, reason: 'processed' };
      }

      const existingTs = new Date(existing.updated_at || existing.received_at || 0).getTime();
      const isFreshProcessing = existing.status === 'processing' && Number.isFinite(existingTs)
        && (Date.now() - existingTs) < staleMs;
      if (isFreshProcessing) {
        return { shouldProcess: false, reason: 'in_progress' };
      }

      const nextRetryCount = Number(existing.retry_count || 0) + 1;
      const { error: updateError } = await db
        .from('processed_updates')
        .update({
          status: 'processing',
          updated_at: now,
          retry_count: nextRetryCount,
        })
        .eq('update_id', Number(id));
      if (updateError) throw updateError;

      return { shouldProcess: true, reason: 'retry' };
    },
    completeUpdateProcessing: async (updateId) => {
      const id = normalizeUpdateId(updateId);
      const now = nowIso();
      const { error } = await db
        .from('processed_updates')
        .update({
          status: 'processed',
          updated_at: now,
          processed_at: now,
          last_error: null,
        })
        .eq('update_id', Number(id));
      if (error) throw error;

    },
    failUpdateProcessing: async (updateId, errorMessage) => {
      const id = normalizeUpdateId(updateId);
      const now = nowIso();
      const message = String(errorMessage || 'unknown error').slice(0, 1000);
      const { data: existing, error: readError } = await db
        .from('processed_updates')
        .select('retry_count,received_at')
        .eq('update_id', Number(id))
        .maybeSingle();
      if (readError) throw readError;

      const nextRetryCount = Number(existing?.retry_count || 0) + 1;
      const { error } = await db
        .from('processed_updates')
        .upsert({
          update_id: Number(id),
          status: 'failed',
          received_at: existing?.received_at || now,
          updated_at: now,
          retry_count: nextRetryCount,
          last_error: message,
        }, { onConflict: 'update_id' });
      if (error) throw error;

    },
    touchGroupActivity: async (groupId, at = new Date().toISOString()) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const timestamp = parseIso(at, nowIso());
      const { error } = await db
        .from('groups')
        .update({ last_activity_at: timestamp })
        .eq('id', groupRowId);
      if (error) throw error;

    },
    listInactiveGroups: async (beforeIso) => {
      const cutoff = new Date(beforeIso).getTime();
      const { data, error } = await db
        .from('groups')
        .select('telegram_chat_id,last_activity_at');
      if (error) throw error;

      return (data || [])
        .map((row) => ({
          groupId: row.telegram_chat_id,
          lastActivityAt: row.last_activity_at,
        }))
        .filter(({ lastActivityAt }) => Number.isFinite(new Date(lastActivityAt).getTime()) && new Date(lastActivityAt).getTime() < cutoff)
        .sort((a, b) => new Date(a.lastActivityAt) - new Date(b.lastActivityAt));
    },
    clearGroupData: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      try {
        const groupRowId = await findGroupRowId(gid);
        if (groupRowId) {
          const { error } = await db
            .from('groups')
            .delete()
            .eq('id', groupRowId);
          if (error) throw error;
        }
      } catch (e) {
        console.warn('⚠️  V2 clearGroupData failed; continuing KV cleanup:', e?.message || e);
      }

    },
  };
}

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const backend = useSupabase ? await supabaseBackend() : fileBackend;
console.log(useSupabase ? '🗄️  Storage: Supabase' : '🗄️  Storage: local files');

export default backend;
