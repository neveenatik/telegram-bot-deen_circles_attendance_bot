/**
 * Session participant accessor.
 *
 * A session stores participant data as a single name-keyed collection:
 *   session.participants[name] = { name, memberId, status, called, page?, verse?, registeredAt? }
 *   - memberId: Telegram userId as a string for registered members, null for guests.
 *   - status/called: attendance + call state (may be null).
 *   - page/verse/registeredAt: absent (undefined) until set.
 * (session.activityByUserId is separate — keyed by Telegram userId, reserved for a
 * future activity-reporting feature — and is NOT managed here.)
 *
 * This module is the single choke point for reading/writing participant data. Call
 * sites address participants by display name and receive/return plain view objects:
 *   { name, memberId, isGuest, status, called, page, verse, registeredAt }
 *
 * Design rules:
 * - Existence = the name has a record in `session.participants`.
 * - The collection is created lazily; reads never assume it exists.
 * - Names are unique within a session, so name-keying is safe; rename just re-keys
 *   the one record (and updates its `.name`).
 */

function ensureParticipants(session) {
  if (!session.participants || typeof session.participants !== 'object' || Array.isArray(session.participants)) {
    session.participants = {};
  }
  return session.participants;
}

function readParticipants(session) {
  const p = session?.participants;
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

/** Get (creating if needed) the mutable record for `name`. */
function ensureRecord(session, name) {
  const parts = ensureParticipants(session);
  if (!parts[name]) parts[name] = { name, memberId: null, status: null, called: null };
  return parts[name];
}

/** True if `name` is a known participant of the session. */
export function has(session, name) {
  return name in readParticipants(session);
}

/** Resolve a participant to a view object, or null if unknown. */
export function get(session, name) {
  const rec = readParticipants(session)[name];
  if (!rec) return null;
  const uid = rec.memberId != null ? String(rec.memberId) : null;
  const view = {
    name,
    memberId: uid,
    isGuest: !uid,
    status: rec.status ?? null,
    called: rec.called ?? null,
  };
  if (rec.page !== undefined) view.page = rec.page;
  if (rec.verse !== undefined) view.verse = rec.verse;
  if (rec.registeredAt !== undefined) view.registeredAt = rec.registeredAt;
  return view;
}

/** All participant names. */
export function names(session) {
  return Object.keys(readParticipants(session));
}

/**
 * All participants as view objects, sorted by registration time (ascending).
 * Participants without a registration time sort last, preserving insertion order.
 */
export function list(session) {
  const parts = readParticipants(session);
  return Object.keys(parts)
    .map((name) => get(session, name))
    .filter(Boolean)
    .sort((a, b) => {
      const ta = parts[a.name]?.registeredAt;
      const tb = parts[b.name]?.registeredAt;
      if (ta === undefined && tb === undefined) return 0;
      if (ta === undefined) return 1;
      if (tb === undefined) return -1;
      return ta - tb;
    });
}

// ─── Field getters ─────────────────────────────────────────────────────────────

export const getStatus       = (session, name) => readParticipants(session)[name]?.status ?? null;
export const getCalled       = (session, name) => readParticipants(session)[name]?.called ?? null;
export const getPage         = (session, name) => readParticipants(session)[name]?.page;
export const getVerse        = (session, name) => readParticipants(session)[name]?.verse;
export const getMemberId     = (session, name) => {
  const v = readParticipants(session)[name]?.memberId;
  return v != null ? String(v) : null;
};
export const getRegisteredAt = (session, name) => readParticipants(session)[name]?.registeredAt;

// ─── Field setters ─────────────────────────────────────────────────────────────

export function setStatus(session, name, status) {
  ensureRecord(session, name).status = status ?? null;
}

export function setCalled(session, name, state) {
  ensureRecord(session, name).called = state ?? null;
}

export function setPage(session, name, page) {
  ensureRecord(session, name).page = page;
}

export function clearPage(session, name) {
  const rec = readParticipants(session)[name];
  if (rec) delete rec.page;
}

/** Clear every page assignment (used when re-deriving pages for all present members). */
export function clearAllPages(session) {
  for (const rec of Object.values(readParticipants(session))) delete rec.page;
}

export function setVerse(session, name, verse) {
  ensureRecord(session, name).verse = verse;
}

export function setMemberId(session, name, uid) {
  ensureRecord(session, name).memberId = uid != null ? String(uid) : null;
}

export function setRegisteredAt(session, name, ts) {
  ensureRecord(session, name).registeredAt = ts;
}

/** Set registration time only if the participant does not already have one. */
export function ensureRegisteredAt(session, name, ts = Date.now()) {
  const rec = ensureRecord(session, name);
  if (!rec.registeredAt) rec.registeredAt = ts;
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

/** Remove a participant entirely. */
export function remove(session, name) {
  const parts = readParticipants(session);
  delete parts[name];
}

/**
 * Rename a participant, re-keying its record and updating `.name`.
 * No-op if `oldName` is unknown or equal to `newName`.
 */
export function rename(session, oldName, newName) {
  if (oldName === newName) return;
  const parts = readParticipants(session);
  const rec = parts[oldName];
  if (!rec) return;
  rec.name = newName;
  parts[newName] = rec;
  delete parts[oldName];
}
