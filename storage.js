const fs   = require('fs');
const path = require('path');

// ─── Local file backend (dev / fallback) ──────────────────────────────────────
const DATA_DIR           = path.join(__dirname, 'data');
const MASTER_FILE        = path.join(DATA_DIR, 'masterList.json');
const SESSIONS_FILE      = path.join(DATA_DIR, 'sessions.json');
const CURRENT_FILE       = path.join(DATA_DIR, 'currentSession.json');
const AWAIT_FILE         = path.join(DATA_DIR, 'awaiting.json');
const PAGE_PROGRESS_FILE = path.join(DATA_DIR, 'pageProgress.json');

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
  getSession:     async (groupId)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    return all[gid] || null;
  },
  saveSession:    async (groupId, s) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    all[gid] = s;
    writeJSON(CURRENT_FILE, all);
  },
  clearSession:   async (groupId)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(CURRENT_FILE);
    all[gid] = null;
    writeJSON(CURRENT_FILE, all);
  },
  getSessions:    async (groupId)  => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const h = all[gid] || { sessions: [], currentSeries: 1 };
    return Array.isArray(h.sessions) ? h.sessions : [];
  },
  saveSessions:   async (groupId, sessions) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const h = all[gid] || { sessions: [], currentSeries: 1 };
    h.sessions = sessions;
    if (!Number.isInteger(h.currentSeries) || h.currentSeries < 1) h.currentSeries = 1;
    all[gid] = h;
    writeJSON(SESSIONS_FILE, all);
  },
  getCurrentSeries: async (groupId) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const h = all[gid] || { sessions: [], currentSeries: 1 };
    return Number.isInteger(h.currentSeries) && h.currentSeries > 0 ? h.currentSeries : 1;
  },
  saveCurrentSeries: async (groupId, series) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const h = all[gid] || { sessions: [], currentSeries: 1 };
    h.currentSeries = Number.isInteger(series) && series > 0 ? series : 1;
    all[gid] = h;
    writeJSON(SESSIONS_FILE, all);
  },
  archiveSession: async (groupId, s) => {
    const gid = normalizeGroupId(groupId);
    const all = readMap(SESSIONS_FILE);
    const h = all[gid] || { sessions: [], currentSeries: 1 };
    h.sessions.push(s);
    if (!Number.isInteger(h.currentSeries) || h.currentSeries < 1) h.currentSeries = 1;
    all[gid] = h;
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
};

// ─── Supabase backend (production) ─────────────────────────────────────────────
// Table:  kv ( key text primary key, value jsonb )
function supabaseBackend() {
  const { createClient } = require('@supabase/supabase-js');
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
  return {
    getMaster:      async (groupId)  => {
      const gid = normalizeGroupId(groupId);
      return (await get(`master:${gid}`)) || { members: [] };
    },
    saveMaster:     async (groupId, d) => {
      const gid = normalizeGroupId(groupId);
      await set(`master:${gid}`, d);
    },
    getSession:     async (groupId)  => {
      const gid = normalizeGroupId(groupId);
      return (await get(`current:${gid}`)) || null;
    },
    saveSession:    async (groupId, s) => {
      const gid = normalizeGroupId(groupId);
      await set(`current:${gid}`, s);
    },
    clearSession:   async (groupId)  => {
      const gid = normalizeGroupId(groupId);
      await set(`current:${gid}`, null);
    },
    getSessions:    async (groupId)  => {
      const gid = normalizeGroupId(groupId);
      return ((await get(`sessions:${gid}`)) || { sessions: [] }).sessions;
    },
    saveSessions:   async (groupId, sessions) => {
      const gid = normalizeGroupId(groupId);
      const h = (await get(`sessions:${gid}`)) || { sessions: [], currentSeries: 1 };
      h.sessions = sessions;
      if (!Number.isInteger(h.currentSeries) || h.currentSeries < 1) h.currentSeries = 1;
      await set(`sessions:${gid}`, h);
    },
    getCurrentSeries: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const h = (await get(`sessions:${gid}`)) || { sessions: [], currentSeries: 1 };
      return Number.isInteger(h.currentSeries) && h.currentSeries > 0 ? h.currentSeries : 1;
    },
    saveCurrentSeries: async (groupId, series) => {
      const gid = normalizeGroupId(groupId);
      const h = (await get(`sessions:${gid}`)) || { sessions: [], currentSeries: 1 };
      h.currentSeries = Number.isInteger(series) && series > 0 ? series : 1;
      await set(`sessions:${gid}`, h);
    },
    archiveSession: async (groupId, s) => {
      const gid = normalizeGroupId(groupId);
      const h = (await get(`sessions:${gid}`)) || { sessions: [], currentSeries: 1 };
      h.sessions.push(s);
      if (!Number.isInteger(h.currentSeries) || h.currentSeries < 1) h.currentSeries = 1;
      await set(`sessions:${gid}`, h);
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
  };
}

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const backend     = useSupabase ? supabaseBackend() : fileBackend;
console.log(useSupabase ? '🗄️  Storage: Supabase' : '🗄️  Storage: local files');

module.exports = backend;
