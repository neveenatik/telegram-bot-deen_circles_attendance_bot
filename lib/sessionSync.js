export function syncSessionNamesFromMaster(session, master) {
  // Public-registration sessions can contain names not in master; keep them intact.
  if (session.allowPublicRegistration) {
    return { changed: false, kept: 0, added: 0, removed: 0 };
  }

  const masterMembers = Array.isArray(master?.members) ? master.members : [];
  const masterNames = masterMembers.map((m) => m.name);
  const masterNameToId = new Map(masterMembers.map((m) => [m.name, String(m.userId)]));
  const masterIds = new Set(masterMembers.map((m) => String(m.userId)));

  const prev = (session.participants && typeof session.participants === 'object' && !Array.isArray(session.participants))
    ? session.participants
    : {};

  // Backfill IDs for existing names when this metadata was not present.
  for (const name of Object.keys(prev)) {
    if (!prev[name].memberId && masterNameToId.has(name)) {
      prev[name].memberId = masterNameToId.get(name);
    }
  }

  // uid → first prev participant name carrying that id.
  const idToPrevName = new Map();
  for (const [name, rec] of Object.entries(prev)) {
    const memberId = rec.memberId;
    if (!memberId || idToPrevName.has(String(memberId))) continue;
    idToPrevName.set(String(memberId), name);
  }

  const next = {};
  const usedPrevNames = new Set();

  let kept = 0;
  let added = 0;

  for (const member of masterMembers) {
    const name = member.name;
    const memberId = String(member.userId);

    let sourceName = null;
    if (Object.prototype.hasOwnProperty.call(prev, name)) {
      sourceName = name;
    } else if (idToPrevName.has(memberId)) {
      sourceName = idToPrevName.get(memberId);
    }

    const src = sourceName ? prev[sourceName] : null;
    const rec = { name, memberId, status: null, called: null };
    if (src) {
      rec.status = src.status ?? null;
      rec.called = src.called ?? null;
      if (src.page !== undefined) rec.page = src.page;
      if (src.verse !== undefined) rec.verse = src.verse;
      if (src.registeredAt !== undefined) rec.registeredAt = src.registeredAt;
      usedPrevNames.add(sourceName);
      kept += 1;
    } else {
      added += 1;
    }
    next[name] = rec;
  }

  // Preserve unmatched historical entries so refresh never drops attendance state.
  let preservedLegacy = 0;
  for (const oldName of Object.keys(prev)) {
    if (usedPrevNames.has(oldName) || masterNames.includes(oldName)) continue;

    // If this legacy key points to a memberId that still exists in master,
    // it is an old alias of a current member and must not be preserved,
    // otherwise reports can show both old and new names.
    const legacyId = prev[oldName].memberId ? String(prev[oldName].memberId) : null;
    if (legacyId && masterIds.has(legacyId)) continue;

    next[oldName] = { ...prev[oldName], name: oldName };
    preservedLegacy += 1;
  }

  const removed = 0;
  const prevWithId = Object.values(prev).filter((r) => r.memberId).length;
  const nextWithId = Object.values(next).filter((r) => r.memberId).length;
  const changed =
    added > 0 ||
    preservedLegacy > 0 ||
    prevWithId !== nextWithId;

  if (!changed) {
    return { changed: false, kept, added, removed };
  }

  session.participants = next;

  return { changed: true, kept, added, removed };
}
