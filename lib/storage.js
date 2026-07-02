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
    const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
    const result = [];
    for (const type of types) {
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
  const get = async (key) => {
    const { data } = await db.from('kv').select('value').eq('key', key).maybeSingle();
    return data ? data.value : null;
  };
  const set = async (key, value) => { await db.from('kv').upsert({ key, value }); };
  const del = async (key) => { await db.from('kv').delete().eq('key', key); };
  return {
    getMaster:      async (groupId)  => {
      const gid = normalizeGroupId(groupId);
      return (await get(`master:${gid}`)) || { members: [] };
    },
    saveMaster:     async (groupId, d) => {
      const gid = normalizeGroupId(groupId);
      await set(`master:${gid}`, d);
    },
    getSession:     async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`current:${gid}`)) || {};
      return byGroup[type] || null;
    },
    saveSession:    async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`current:${gid}`)) || {};
      byGroup[type] = s;
      await set(`current:${gid}`, byGroup);
    },
    clearSession:   async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`current:${gid}`)) || {};
      delete byGroup[type];
      await set(`current:${gid}`, byGroup);
    },
    getSessions:    async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`sessions:${gid}`)) || {};
      const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : { sessions: [] };
      return Array.isArray(byType.sessions) ? byType.sessions : [];
    },
    saveSessions:   async (groupId, type, sessions) => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`sessions:${gid}`)) || {};
      const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : { sessions: [] };
      byType.sessions = Array.isArray(sessions) ? sessions : [];
      byGroup[type] = byType;
      await set(`sessions:${gid}`, byGroup);
    },
    archiveSession: async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`sessions:${gid}`)) || {};
      const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : { sessions: [] };
      if (!Array.isArray(byType.sessions)) byType.sessions = [];
      byType.sessions.push(s);
      byGroup[type] = byType;
      await set(`sessions:${gid}`, byGroup);
    },
    getAwaiting:    async (groupId, uid)    => {
      const gid = normalizeGroupId(groupId);
      return get(`await:${gid}:${uid}`);
    },
    setAwaiting:    async (groupId, uid, v) => {
      const gid = normalizeGroupId(groupId);
      await set(`await:${gid}:${uid}`, v);
    },
    delAwaiting:    async (groupId, uid)    => {
      const gid = normalizeGroupId(groupId);
      await set(`await:${gid}:${uid}`, null);
    },
    getPageProgress: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      return (await get(`pageprogress:${gid}`)) || {};
    },
    savePageProgress: async (groupId, data) => {
      const gid = normalizeGroupId(groupId);
      await set(`pageprogress:${gid}`, data);
    },
    getGroupRecitationNextPage: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const data = (await get(`grouprecitation:${gid}`)) || {};
      return (data && typeof data === 'object' ? data.nextPage : null) || 1;
    },
    saveGroupRecitationNextPage: async (groupId, nextPage) => {
      const gid = normalizeGroupId(groupId);
      const data = (await get(`grouprecitation:${gid}`)) || {};
      data.nextPage = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 1;
      await set(`grouprecitation:${gid}`, data);
    },
    getCurrentSeries: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const data = (await get(`series:${gid}`)) || {};
      const s = data.current;
      return Number.isInteger(s) && s > 0 ? s : 1;
    },
    saveCurrentSeries: async (groupId, series) => {
      const gid = normalizeGroupId(groupId);
      const s = Number.isInteger(series) && series > 0 ? series : 1;
      await set(`series:${gid}`, { current: s });
    },
    getAllSessions: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const byGroup = (await get(`sessions:${gid}`)) || {};
      const types = ['main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'];
      const result = [];
      for (const type of types) {
        const byType = byGroup[type] && typeof byGroup[type] === 'object' ? byGroup[type] : {};
        if (Array.isArray(byType.sessions)) result.push(...byType.sessions);
      }
      return result.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    },
    getTeachers: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      return (await get(`teachers:${gid}`)) || [];
    },
    saveTeachers: async (groupId, teachers) => {
      const gid = normalizeGroupId(groupId);
      await set(`teachers:${gid}`, Array.isArray(teachers) ? teachers : []);
    },
    touchGroupActivity: async (groupId, at = new Date().toISOString()) => {
      const gid = normalizeGroupId(groupId);
      await set(`activity:${gid}`, { lastActivityAt: at });
    },
    listInactiveGroups: async (beforeIso) => {
      const cutoff = new Date(beforeIso).getTime();
      const { data, error } = await db
        .from('kv')
        .select('key,value')
        .like('key', 'activity:%');

      if (error) throw error;

      return (data || [])
        .map((row) => ({
          groupId: String(row.key).slice('activity:'.length),
          lastActivityAt: row.value?.lastActivityAt,
        }))
        .filter(({ lastActivityAt }) => Number.isFinite(new Date(lastActivityAt).getTime()) && new Date(lastActivityAt).getTime() < cutoff)
        .sort((a, b) => new Date(a.lastActivityAt) - new Date(b.lastActivityAt));
    },
    clearGroupData: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      await Promise.all([
        del(`master:${gid}`),
        del(`sessions:${gid}`),
        del(`current:${gid}`),
        del(`pageprogress:${gid}`),
        del(`grouprecitation:${gid}`),
        del(`series:${gid}`),
        del(`teachers:${gid}`),
        del(`activity:${gid}`),
      ]);
    },
  };
}

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const backend = useSupabase ? await supabaseBackend() : fileBackend;
console.log(useSupabase ? '🗄️  Storage: Supabase' : '🗄️  Storage: local files');

export default backend;
