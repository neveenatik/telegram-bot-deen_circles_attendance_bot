export function syncSessionNamesFromMaster(session, master) {
  // Public-registration sessions can contain names not in master; keep them intact.
  if (session.allowPublicRegistration) {
    return { changed: false, kept: 0, added: 0, removed: 0 };
  }

  const masterMembers = Array.isArray(master?.members) ? master.members : [];
  const masterNames = masterMembers.map((m) => m.name);
  const masterNameToId = new Map(masterMembers.map((m) => [m.name, String(m.userId)]));
  const prevAttendance = session.attendance || {};
  const prevCalled = session.called || {};
  const prevPages = session.pages || {};
  const prevVerses = session.verses || {};
  const prevRegistrationTimes = session.registrationTimes || {};
  const prevMemberIds = session.memberIds && typeof session.memberIds === 'object' ? session.memberIds : {};

  // Backfill IDs for existing names when this metadata was not present.
  for (const name of Object.keys(prevAttendance)) {
    if (!prevMemberIds[name] && masterNameToId.has(name)) {
      prevMemberIds[name] = masterNameToId.get(name);
    }
  }

  const idToPrevName = new Map();
  for (const [name, memberId] of Object.entries(prevMemberIds)) {
    if (!memberId || idToPrevName.has(String(memberId))) continue;
    if (Object.prototype.hasOwnProperty.call(prevAttendance, name)) {
      idToPrevName.set(String(memberId), name);
    }
  }

  const nextAttendance = {};
  const nextCalled = {};
  const nextPages = {};
  const nextVerses = {};
  const nextRegistrationTimes = {};
  const nextMemberIds = {};
  const usedPrevNames = new Set();

  let kept = 0;
  let added = 0;

  for (const member of masterMembers) {
    const name = member.name;
    const memberId = String(member.userId);

    let sourceName = null;
    if (Object.prototype.hasOwnProperty.call(prevAttendance, name)) {
      sourceName = name;
    } else if (idToPrevName.has(memberId)) {
      sourceName = idToPrevName.get(memberId);
    }

    if (sourceName && Object.prototype.hasOwnProperty.call(prevAttendance, sourceName)) {
      nextAttendance[name] = prevAttendance[sourceName];
      usedPrevNames.add(sourceName);
      kept += 1;
    } else {
      nextAttendance[name] = null;
      added += 1;
    }

    const sourceKey = sourceName || name;
    if (Object.prototype.hasOwnProperty.call(prevCalled, sourceKey)) nextCalled[name] = prevCalled[sourceKey];
    if (Object.prototype.hasOwnProperty.call(prevPages, sourceKey)) nextPages[name] = prevPages[sourceKey];
    if (Object.prototype.hasOwnProperty.call(prevVerses, sourceKey)) nextVerses[name] = prevVerses[sourceKey];
    if (Object.prototype.hasOwnProperty.call(prevRegistrationTimes, sourceKey)) nextRegistrationTimes[name] = prevRegistrationTimes[sourceKey];
    nextMemberIds[name] = memberId;
  }

  // Preserve unmatched historical entries so refresh never drops attendance state.
  let preservedLegacy = 0;
  for (const oldName of Object.keys(prevAttendance)) {
    if (usedPrevNames.has(oldName) || masterNames.includes(oldName)) continue;
    nextAttendance[oldName] = prevAttendance[oldName];
    if (Object.prototype.hasOwnProperty.call(prevCalled, oldName)) nextCalled[oldName] = prevCalled[oldName];
    if (Object.prototype.hasOwnProperty.call(prevPages, oldName)) nextPages[oldName] = prevPages[oldName];
    if (Object.prototype.hasOwnProperty.call(prevVerses, oldName)) nextVerses[oldName] = prevVerses[oldName];
    if (Object.prototype.hasOwnProperty.call(prevRegistrationTimes, oldName)) nextRegistrationTimes[oldName] = prevRegistrationTimes[oldName];
    if (prevMemberIds[oldName]) nextMemberIds[oldName] = prevMemberIds[oldName];
    preservedLegacy += 1;
  }

  const removed = 0;
  const changed =
    added > 0 ||
    preservedLegacy > 0 ||
    Object.keys(prevMemberIds).length !== Object.keys(nextMemberIds).length;

  if (!changed) {
    return { changed: false, kept, added, removed };
  }

  session.attendance = nextAttendance;
  session.called = nextCalled;
  if (session.pages) session.pages = nextPages;
  if (session.verses) session.verses = nextVerses;
  session.registrationTimes = nextRegistrationTimes;
  session.memberIds = nextMemberIds;

  return { changed: true, kept, added, removed };
}
