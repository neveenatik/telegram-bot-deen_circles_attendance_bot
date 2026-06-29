const fs   = require('fs');
const path = require('path');

// ─── Local file backend (dev / fallback) ──────────────────────────────────────
const DATA_DIR      = path.join(__dirname, 'data');
const MASTER_FILE   = path.join(DATA_DIR, 'masterList.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const CURRENT_FILE  = path.join(DATA_DIR, 'currentSession.json');
const AWAIT_FILE    = path.join(DATA_DIR, 'awaiting.json');

const readJSON  = (f)    => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

const fileBackend = {
  getMaster:      async ()  => readJSON(MASTER_FILE) || { members: [] },
  saveMaster:     async (d) => writeJSON(MASTER_FILE, d),
  getSession:     async ()  => readJSON(CURRENT_FILE),
  saveSession:    async (s) => writeJSON(CURRENT_FILE, s),
  clearSession:   async ()  => writeJSON(CURRENT_FILE, null),
  getSessions:    async ()  => (readJSON(SESSIONS_FILE) || { sessions: [] }).sessions,
  archiveSession: async (s) => {
    const h = readJSON(SESSIONS_FILE) || { sessions: [] };
    h.sessions.push(s);
    writeJSON(SESSIONS_FILE, h);
  },
  getAwaiting:    async (uid)    => (readJSON(AWAIT_FILE) || {})[uid] || null,
  setAwaiting:    async (uid, v) => { const a = readJSON(AWAIT_FILE) || {}; a[uid] = v; writeJSON(AWAIT_FILE, a); },
  delAwaiting:    async (uid)    => { const a = readJSON(AWAIT_FILE) || {}; delete a[uid]; writeJSON(AWAIT_FILE, a); },
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
    getMaster:      async ()  => (await get('master')) || { members: [] },
    saveMaster:     async (d) => set('master', d),
    getSession:     async ()  => (await get('current')) || null,
    saveSession:    async (s) => set('current', s),
    clearSession:   async ()  => set('current', null),
    getSessions:    async ()  => ((await get('sessions')) || { sessions: [] }).sessions,
    archiveSession: async (s) => {
      const h = (await get('sessions')) || { sessions: [] };
      h.sessions.push(s);
      await set('sessions', h);
    },
    getAwaiting:    async (uid)    => get(`await:${uid}`),
    setAwaiting:    async (uid, v) => set(`await:${uid}`, v),
    delAwaiting:    async (uid)    => set(`await:${uid}`, null),
  };
}

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const backend     = useSupabase ? supabaseBackend() : fileBackend;
console.log(useSupabase ? '🗄️  Storage: Supabase' : '🗄️  Storage: local files');

module.exports = backend;
