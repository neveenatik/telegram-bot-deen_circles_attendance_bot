/**
 * Session participant accessor.
 *
 * A session stores participant data as a single name-keyed collection:
 *   session.participants[name] = { name, memberId, status, called, page?, verse?, registeredAt?, attendedMain? }
 *   - memberId: Telegram userId as a string for registered members, null for guests.
 *   - status/called: attendance + call state (may be null).
 *   - page/verse/registeredAt: absent (undefined) until set.
 *   - attendedMain: recitation-correction only — whether she attested to attending
 *     the main session (true) or explicitly did not (false); undefined otherwise.
 *   - backup: recitation-correction only — true when she registered on the reserve
 *     list after registration was frozen; undefined otherwise.
 *   - listNumber: the member's roster number (integer); absent for guests.
 * (session.activityByUserId is separate — keyed by Telegram userId, reserved for a
 * future activity-reporting feature — and is NOT managed here.)
 *
 * This module is the single choke point for reading/writing participant data. Call
 * sites address participants by display name and receive/return plain view objects:
 *   { name, memberId, isGuest, status, called, page, verse, registeredAt, attendedMain, backup, listNumber }
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
  if (rec.attendedMain !== undefined) view.attendedMain = rec.attendedMain;
  if (rec.backup !== undefined) view.backup = rec.backup;
  if (rec.listNumber != null) view.listNumber = rec.listNumber;
  return view;
}

/** All participant names. */
export function names(session) {
  return Object.keys(readParticipants(session));
}

/**
 * Display label for a participant: `<listNumber> - <name>` when the member has a
 * roster number, otherwise just the name (guests/unregistered have no number).
 */
export function label(session, name) {
  const n = readParticipants(session)[name]?.listNumber;
  return n != null ? `${n} - ${name}` : name;
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
export const getAttendedMain = (session, name) => readParticipants(session)[name]?.attendedMain;
export const getBackup       = (session, name) => readParticipants(session)[name]?.backup;
export const getListNumber   = (session, name) => readParticipants(session)[name]?.listNumber ?? null;

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

export function setAttendedMain(session, name, attended) {
  ensureRecord(session, name).attendedMain = attended;
}

export function setBackup(session, name, backup) {
  ensureRecord(session, name).backup = backup;
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
export function register(session, name, { memberId, status, registeredAt, attendedMain, backup } = {}) {
  if (status !== undefined) setStatus(session, name, status);
  if (memberId !== undefined) setMemberId(session, name, memberId);
  if (registeredAt !== undefined) setRegisteredAt(session, name, registeredAt);
  if (attendedMain !== undefined) setAttendedMain(session, name, attendedMain);
  if (backup !== undefined) setBackup(session, name, backup);
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

// ─── Callback-data addressing ────────────────────────────────────────────────
// Inline-keyboard buttons must encode *which participant* they act on inside a
// ≤64-byte callback string, then resolve it back on tap. Registered members are
// addressed by their Telegram userId (`u<id>`), which is immune to renames and
// row reordering; guests have no userId, so they fall back to a positional index
// (`g<i>`) within the caller's ordered name list. Every widget shares this scheme
// so a single fix covers all of them — the only thing each widget owns is the
// ORDER of its name list (insertion order, Arabic sort, recitation queue…), which
// it passes into `resolveToken`.

/** Build the callback token addressing `name` at `displayIndex` in the widget's list. */
export function memberToken(session, name, displayIndex) {
  const uid = getMemberId(session, name);
  return uid ? `u${uid}` : `g${displayIndex}`;
}

/**
 * Resolve a callback token against the widget's ordered name list.
 * Returns `{ name, index }`, or null if the target is gone / out of range.
 * Bare digits are accepted as a legacy positional index (pre-token widgets).
 */
export function resolveToken(session, orderedNames, token) {
  if (typeof token === 'string' && token[0] === 'u') {
    const uid = token.slice(1);
    const index = orderedNames.findIndex((n) => getMemberId(session, n) === uid);
    if (index === -1) return null;
    return { name: orderedNames[index], index };
  }
  const raw = typeof token === 'string' && token[0] === 'g' ? token.slice(1) : token;
  const index = parseInt(raw, 10);
  if (!Number.isInteger(index) || index < 0 || index >= orderedNames.length) return null;
  return { name: orderedNames[index], index };
}
