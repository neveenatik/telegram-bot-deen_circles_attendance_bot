/**
 * Session participant accessor.
 *
 * A session currently stores participant data as several PARALLEL MAPS, all keyed
 * by display name:
 *   attendance, called, pages, verses, registrationTimes, memberIds
 * (plus activityByUserId, which is keyed by Telegram userId — reserved for a future
 * activity-reporting feature).
 *
 * This module is the single choke point for reading/writing that data. Today it
 * operates directly on the parallel maps so it is 100% behaviour-preserving. Once
 * every call site goes through here, the internal representation can be swapped for
 * a single id-keyed `session.participants` collection WITHOUT touching call sites.
 *
 * A "participant" is identified by display name at the API surface (matching the
 * current model). Each participant resolves to a plain view object:
 *   { name, memberId, isGuest, status, called, page, verse, registeredAt }
 *
 * Design rules:
 * - Existence = the name appears in `attendance` OR `memberIds` (mirrors the union
 *   used by storage.upsertSessionParticipants).
 * - `pages` and `verses` maps only exist for certain session types; reads are always
 *   safe, writes lazily create the map.
 * - No map is assumed to exist. All access is guarded here so call sites never repeat
 *   `if (!session.x) session.x = {}`.
 */

const MAPS = ['attendance', 'called', 'pages', 'verses', 'registrationTimes', 'memberIds'];

function ensureMap(session, key) {
  if (!session[key] || typeof session[key] !== 'object' || Array.isArray(session[key])) {
    session[key] = {};
  }
  return session[key];
}

function readMap(session, key) {
  const m = session[key];
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** True if `name` is a known participant of the session. */
export function has(session, name) {
  return name in readMap(session, 'attendance') || name in readMap(session, 'memberIds');
}

/** Resolve a participant to a view object, or null if unknown. */
export function get(session, name) {
  if (!has(session, name)) return null;
  const memberId = readMap(session, 'memberIds')[name];
  const uid = memberId != null ? String(memberId) : null;
  const view = {
    name,
    memberId: uid,
    isGuest: !uid,
    status: readMap(session, 'attendance')[name] ?? null,
    called: readMap(session, 'called')[name] ?? null,
  };
  const page = readMap(session, 'pages')[name];
  if (page !== undefined) view.page = page;
  const verse = readMap(session, 'verses')[name];
  if (verse !== undefined) view.verse = verse;
  const registeredAt = readMap(session, 'registrationTimes')[name];
  if (registeredAt !== undefined) view.registeredAt = registeredAt;
  return view;
}

/** All participant names (union of attendance + memberIds keys). */
export function names(session) {
  return Array.from(new Set([
    ...Object.keys(readMap(session, 'attendance')),
    ...Object.keys(readMap(session, 'memberIds')),
  ]));
}

/**
 * All participants as view objects, sorted by registration time (ascending).
 * Participants without a registration time sort last, preserving insertion order.
 */
export function list(session) {
  const regTimes = readMap(session, 'registrationTimes');
  return names(session)
    .map((name) => get(session, name))
    .filter(Boolean)
    .sort((a, b) => {
      const ta = regTimes[a.name];
      const tb = regTimes[b.name];
      if (ta === undefined && tb === undefined) return 0;
      if (ta === undefined) return 1;
      if (tb === undefined) return -1;
      return ta - tb;
    });
}

// ─── Field getters ─────────────────────────────────────────────────────────────

export const getStatus       = (session, name) => readMap(session, 'attendance')[name] ?? null;
export const getCalled       = (session, name) => readMap(session, 'called')[name] ?? null;
export const getPage         = (session, name) => readMap(session, 'pages')[name];
export const getVerse        = (session, name) => readMap(session, 'verses')[name];
export const getMemberId     = (session, name) => {
  const v = readMap(session, 'memberIds')[name];
  return v != null ? String(v) : null;
};
export const getRegisteredAt = (session, name) => readMap(session, 'registrationTimes')[name];

// ─── Field setters ─────────────────────────────────────────────────────────────

export function setStatus(session, name, status) {
  ensureMap(session, 'attendance')[name] = status ?? null;
}

export function setCalled(session, name, state) {
  ensureMap(session, 'called')[name] = state ?? null;
}

export function setPage(session, name, page) {
  ensureMap(session, 'pages')[name] = page;
}

export function clearPage(session, name) {
  if (session.pages && name in session.pages) delete session.pages[name];
}

/** Clear every page assignment (used when re-deriving pages for all present members). */
export function clearAllPages(session) {
  session.pages = {};
}

export function setVerse(session, name, verse) {
  ensureMap(session, 'verses')[name] = verse;
}

export function setMemberId(session, name, uid) {
  ensureMap(session, 'memberIds')[name] = uid != null ? String(uid) : null;
}

export function setRegisteredAt(session, name, ts) {
  ensureMap(session, 'registrationTimes')[name] = ts;
}

/** Set registration time only if the participant does not already have one. */
export function ensureRegisteredAt(session, name, ts = Date.now()) {
  const m = ensureMap(session, 'registrationTimes');
  if (!m[name]) m[name] = ts;
}

/**
 * Register (or re-register) a participant in one call. Only the provided fields are
 * written; omitted fields are left untouched.
 */
export function register(session, name, { memberId, status, registeredAt } = {}) {
  if (status !== undefined) setStatus(session, name, status);
  if (memberId !== undefined) setMemberId(session, name, memberId);
  if (registeredAt !== undefined) setRegisteredAt(session, name, registeredAt);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Remove a participant from every parallel map. */
export function remove(session, name) {
  for (const key of MAPS) {
    if (session[key] && name in session[key]) delete session[key][name];
  }
}

/**
 * Rename a participant, moving its entry across every parallel map.
 * No-op if `oldName` is unknown or equal to `newName`.
 */
export function rename(session, oldName, newName) {
  if (oldName === newName) return;
  for (const key of MAPS) {
    const m = session[key];
    if (m && oldName in m) {
      m[newName] = m[oldName];
      delete m[oldName];
    }
  }
}
