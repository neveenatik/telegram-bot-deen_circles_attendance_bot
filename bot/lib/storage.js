import { randomUUID } from 'node:crypto';

const normalizeGroupId = (groupId) => {
  if (groupId === undefined || groupId === null || groupId === '') {
    throw new Error('groupId is required for storage operations');
  }
  return String(groupId);
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

// Shape a class_materials row (with embedded class_material_files) into the
// lesson object handlers expect: files sorted by position, plus a fileCount.
function mapMaterialRow(row) {
  const files = (row.class_material_files || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((f) => ({
      id: f.id,
      fileId: f.file_id,
      fileType: f.file_type,
      fileName: f.file_name || null,
      position: f.position ?? 1,
    }));
  return {
    id: row.id,
    title: row.title,
    addedBy: row.added_by || null,
    createdAt: row.created_at || null,
    files,
    fileCount: files.length,
  };
}

// Map a homework row (with its embedded homework_files) to the shape handlers
// use. Mirrors mapMaterialRow; adds the title/content assignment fields.
function mapHomeworkRow(row) {
  const files = (row.homework_files || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((f) => ({
      id: f.id,
      fileId: f.file_id,
      fileType: f.file_type,
      fileName: f.file_name || null,
      position: f.position ?? 1,
    }));
  return {
    id: row.id,
    title: row.title,
    content: row.content || null,
    sourceMessageId: row.source_message_id ?? null,
    postedBy: row.posted_by || null,
    createdAt: row.created_at || null,
    files,
    fileCount: files.length,
  };
}

// ─── Supabase backend ──────────────────────────────────────────────────────────
// Relational schema v2 (see scripts/supabase_v2.sql)
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

  // Read-only lookup of the active session row id for a group + type. Lets hot
  // paths (participant writes, page allocation) find the session without doing a
  // full blob-overwriting upsert.
  const resolveSessionId = async (groupRowId, type) => {
    const { data, error } = await db
      .from('sessions')
      .select('id')
      .eq('group_id', groupRowId)
      .eq('session_type', type)
      .eq('active', true)
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.id || null;
  };

  const parseIso = (value, fallback = null) => {
    if (!value) return fallback;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : fallback;
  };

  const mapAttendanceStatus = (v) => {
    if (v === 'present' || v === 'listening' || v === 'excused' || v === 'absent') return v;
    return null;
  };

  const mapCalledState = (v) => {
    if (v === 'responding' || v === 'responded' || v === 'away') return v;
    return null;
  };

  /**
   * Batch-load participant data for multiple session IDs.
   * LEFT JOINs active members so all current members appear (even those added after the session).
   * Returns a map of sessionId → { attendance, called, pages, verses, registrationTimes, memberIds }
   */
  const loadParticipantsForSessions = async (sessionIds, groupRowId) => {
    if (!sessionIds.length) return {};

    // PostgREST returns at most 1000 rows per request. A busy group (many
    // archived sessions × dozens of members) easily blows past that, and because
    // rows come back ordered by id the NEWEST sessions' rows get truncated off
    // the end — making their editor/report render empty even though the rows
    // exist. Page through with .range() until a short page signals the end.
    const fetchAllRows = async (buildQuery) => {
      const PAGE = 1000;
      const all = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await buildQuery().range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < PAGE) break;
      }
      return all;
    };

    const [members, participantRows] = await Promise.all([
      fetchAllRows(() => db.from('members').select('id, telegram_user_id, name, list_number').eq('group_id', groupRowId).eq('active', true)
        .order('created_at', { ascending: true })),
      fetchAllRows(() => db.from('session_participants')
        .select('session_id, member_id, guest_name, display_name, attendance_status, called_state, registration_time, pages, verse, attended_main, backup, pending_approval')
        .in('session_id', sessionIds)
        .order('id', { ascending: true })),
    ]);

    const result = {};
    for (const sid of sessionIds) {
      const sessionParts = (participantRows || []).filter((p) => p.session_id === sid);

      // No participant rows yet — caller will fall back to blob data
      if (!sessionParts.length) {
        result[sid] = null;
        continue;
      }

      const partByMemberId = new Map(sessionParts.filter((p) => p.member_id).map((p) => [p.member_id, p]));
      const guestParts = sessionParts.filter((p) => !p.member_id);

      const participants = {};

      // Registered members (LEFT JOIN — includes members added after session)
      for (const member of (members || [])) {
        const name = member.name;
        const p = partByMemberId.get(member.id);
        const rec = {
          name,
          memberId: member.telegram_user_id != null ? String(member.telegram_user_id) : null,
          status: p ? mapAttendanceStatus(p.attendance_status) : null,
          called: p ? mapCalledState(p.called_state) : null,
        };
        if (member.list_number != null) rec.listNumber = member.list_number;
        if (p?.pages) rec.page = p.pages;
        if (p?.verse) rec.verse = p.verse;
        if (p?.registration_time) rec.registeredAt = new Date(p.registration_time).getTime();
        if (p?.attended_main != null) rec.attendedMain = p.attended_main;
        if (p?.backup != null) rec.backup = p.backup;
        if (p?.pending_approval != null) rec.pendingApproval = p.pending_approval;
        participants[name] = rec;
      }

      // Guests
      for (const p of guestParts) {
        const name = p.display_name;
        const rec = {
          name,
          memberId: null,
          status: mapAttendanceStatus(p.attendance_status),
          called: mapCalledState(p.called_state),
        };
        if (p.pages) rec.page = p.pages;
        if (p.verse) rec.verse = p.verse;
        if (p.registration_time) rec.registeredAt = new Date(p.registration_time).getTime();
        if (p.attended_main != null) rec.attendedMain = p.attended_main;
        if (p.backup != null) rec.backup = p.backup;
        if (p.pending_approval != null) rec.pendingApproval = p.pending_approval;
        participants[name] = rec;
      }
      result[sid] = { participants };
    }

    return result;
  };

  const toLegacySessionBlob = (row, participantData = null) => {
    const blob = row?.metadata?.session_blob;
    const base = blob && typeof blob === 'object'
      ? {
          ...blob,
          type: blob.type || row.session_type,
          active: row.active,
          seriesId: row.series_id,
          startedAt: blob.startedAt || parseIso(row.started_at, nowIso()),
          endedAt: blob.endedAt || parseIso(row.ended_at, null),
          archived: row.archived,
        }
      : {
          type: row.session_type,
          name: row.name,
          chatId: row.chat_id,
          messageId: row.widget_message_id || undefined,
          seriesId: row.series_id,
          active: row.active,
          startedAt: parseIso(row.started_at, nowIso()),
          endedAt: parseIso(row.ended_at, null),
          archived: row.archived,
          participants: {},
          actionMessageIds: [],
          listMessageIds: [],
        };

    // The group-recitation page allocator is a real column, not blob data. Make
    // it authoritative over any stale copy still living in an older blob.
    if (row.session_type === 'groupRecitation') {
      base.groupRecitationStartPage = row.group_recitation_next_page;
    }

    if (participantData) {
      return {
        ...base,
        participants: participantData.participants,
      };
    }

    return base;
  };

  /**
   * Sync session attendance/called/pages/verses/registrationTimes → session_participants.
   * Replaces all participant rows for the session on each call.
   */
  const upsertSessionParticipants = async (sessionId, groupRowId, session) => {
    const participants = session.participants && typeof session.participants === 'object' && !Array.isArray(session.participants)
      ? session.participants
      : {};
    const allNames = Object.keys(participants);
    if (!allNames.length) return;

    const { data: members, error: membersError } = await db
      .from('members')
      .select('id, telegram_user_id')
      .eq('group_id', groupRowId)
      .eq('active', true);
    if (membersError) throw membersError;

    const uidToMemberId = new Map((members || []).map((m) => [String(m.telegram_user_id), m.id]));

    const rows = [];
    for (const name of allNames) {
      const rec = participants[name] || {};
      const uid = rec.memberId != null ? String(rec.memberId) : null;
      const memberId = uid ? (uidToMemberId.get(uid) ?? null) : null;
      const regTime = rec.registeredAt;
      rows.push({
        session_id: sessionId,
        member_id: memberId,
        guest_name: memberId ? null : name,
        display_name: name,
        attendance_status: mapAttendanceStatus(rec.status),
        called_state: mapCalledState(rec.called),
        registration_time: regTime ? new Date(regTime).toISOString() : null,
        pages: rec.page != null ? String(rec.page) : null,
        verse: rec.verse || null,
        attended_main: rec.attendedMain ?? null,
        backup: rec.backup ?? null,
        pending_approval: rec.pendingApproval ?? null,
      });
    }

    // Snapshot existing rows before delete so we can restore on insert failure
    const { data: existing, error: snapshotError } = await db
      .from('session_participants')
      .select('session_id, member_id, guest_name, display_name, attendance_status, called_state, registration_time, pages, verse, attended_main, backup, pending_approval')
      .eq('session_id', sessionId);
    if (snapshotError) throw snapshotError;

    const { error: deleteError } = await db
      .from('session_participants')
      .delete()
      .eq('session_id', sessionId);
    if (deleteError) throw deleteError;

    const { error: insertError } = await db.from('session_participants').insert(rows);
    if (insertError) {
      // Attempt to restore previous state
      if (existing?.length) {
        await db.from('session_participants').insert(existing).catch(() => {});
      }
      throw insertError;
    }
  };

  /**
   * Upsert a SINGLE participant row (granular write). Avoids the full delete+re-insert
   * done by upsertSessionParticipants, so concurrent clicks on different participants
   * no longer clobber each other. Resolves uid → members.id via one indexed lookup.
   */
  const upsertParticipant = async (sessionId, groupRowId, session, name) => {
    const rec = session?.participants?.[name];
    if (!rec) return;

    const uid = rec.memberId != null ? String(rec.memberId) : null;
    let memberId = null;
    if (uid) {
      const { data: member, error: memberError } = await db
        .from('members')
        .select('id')
        .eq('group_id', groupRowId)
        .eq('telegram_user_id', uid)
        .eq('active', true)
        .maybeSingle();
      if (memberError) throw memberError;
      memberId = member?.id ?? null;
    }

    const row = {
      session_id: sessionId,
      member_id: memberId,
      guest_name: memberId ? null : name,
      display_name: name,
      attendance_status: mapAttendanceStatus(rec.status),
      called_state: mapCalledState(rec.called),
      registration_time: rec.registeredAt ? new Date(rec.registeredAt).toISOString() : null,
      pages: rec.page != null ? String(rec.page) : null,
      verse: rec.verse || null,
      attended_main: rec.attendedMain ?? null,
      backup: rec.backup ?? null,
      pending_approval: rec.pendingApproval ?? null,
      updated_at: nowIso(),
    };

    // The unique indexes on (session_id, member_id) / (session_id, guest_name)
    // are PARTIAL (WHERE ... is not null). Postgres cannot use a partial index
    // as an ON CONFLICT arbiter without the matching predicate, and PostgREST's
    // upsert can't emit that predicate — so an onConflict upsert here fails with
    // "no unique or exclusion constraint matching the ON CONFLICT specification".
    // Do an explicit update-else-insert keyed on the participant's true identity.
    const keyCol = memberId != null ? 'member_id' : 'guest_name';
    const keyVal = memberId != null ? memberId : name;

    const { data: updated, error: updateError } = await db
      .from('session_participants')
      .update(row)
      .eq('session_id', sessionId)
      .eq(keyCol, keyVal)
      .select('id');
    if (updateError) throw updateError;
    if (updated && updated.length) return;

    const { error: insertError } = await db
      .from('session_participants')
      .insert(row);
    if (insertError) {
      // Lost an insert race with a concurrent tap on the same participant — the
      // row now exists, so apply our values as an update instead of erroring.
      if (insertError.code === '23505') {
        const { error: retryError } = await db
          .from('session_participants')
          .update(row)
          .eq('session_id', sessionId)
          .eq(keyCol, keyVal);
        if (retryError) throw retryError;
        return;
      }
      throw insertError;
    }
  };

  /**
   * Delete a SINGLE participant row by its TRUE unique key (granular remove).
   * Resolves member vs guest the same way upsertParticipant does, so it targets
   * exactly one row via (session_id, member_id) or (session_id, guest_name) —
   * never the non-unique display_name (which could match a member+guest collision).
   * Falls back to a name lookup when the in-memory record is already gone.
   */
  const deleteParticipant = async (sessionId, groupRowId, session, name) => {
    const rec = session?.participants?.[name];
    const uid = rec?.memberId != null ? String(rec.memberId) : null;

    let memberId = null;
    if (uid) {
      const { data: member, error: memberError } = await db
        .from('members')
        .select('id')
        .eq('group_id', groupRowId)
        .eq('telegram_user_id', uid)
        .eq('active', true)
        .maybeSingle();
      if (memberError) throw memberError;
      memberId = member?.id ?? null;
    } else if (rec === undefined) {
      // Record already removed from memory: resolve a registered member by name.
      // (guest rows have no matching active member, so memberId stays null.)
      const { data: member, error: memberError } = await db
        .from('members')
        .select('id')
        .eq('group_id', groupRowId)
        .eq('name', name)
        .eq('active', true)
        .maybeSingle();
      if (memberError) throw memberError;
      memberId = member?.id ?? null;
    }

    const base = db.from('session_participants').delete().eq('session_id', sessionId);
    const { error } = memberId != null
      ? await base.eq('member_id', memberId)
      : await base.eq('guest_name', name);
    if (error) throw error;
  };

  // Build the `sessions` row payload from a legacy session blob. `legacy_key` is
  // the content-derived upsert identity (see upsertSessionRow): one `current:*`
  // slot per (group,type) for the live session, and `archive-live:*:<startedAt>`
  // per archived snapshot.
  const buildSessionPayload = (gid, groupRowId, type, session, archived) => {
    // Strip participant data (stored in session_participants) and the group
    // recitation allocator (its own column, written only by the atomic RPC /
    // setGroupRecitationPageCounter) so a full save never clobbers either.
    const { participants, groupRecitationStartPage, ...blobData } =
      session && typeof session === 'object' ? session : {};

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
      metadata: { session_blob: blobData },
    };

    payload.metadata.legacy_key = archived
      ? `archive-live:${gid}:${type}:${payload.started_at}`
      : `current:${gid}:${type}`;
    return payload;
  };

  const upsertSessionRow = async (gid, type, session, archived = false) => {
    const groupRowId = await ensureGroupRowId(gid);
    const payload = buildSessionPayload(gid, groupRowId, type, session, archived);
    const legacyKey = payload.metadata.legacy_key;

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
        .select('telegram_user_id,name,list_number,welcomed_at,training_group_id')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return {
        members: (data || []).map((row) => ({
          userId: row.telegram_user_id,
          name: row.name,
          listNumber: row.list_number ?? null,
          welcomedAt: row.welcomed_at ?? null,
          trainingGroupId: row.training_group_id ?? null,
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
          welcomed_at: row.welcomedAt ?? null,
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
        .select('id,session_type,name,series_id,active,chat_id,widget_message_id,group_recitation_next_page,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('session_type', type)
        .eq('active', true)
        .eq('archived', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const participantsMap = await loadParticipantsForSessions([data.id], groupRowId);
      return toLegacySessionBlob(data, participantsMap[data.id] || null);
    },
    getActiveSession: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('sessions')
        .select('id,session_type,name,series_id,active,chat_id,widget_message_id,group_recitation_next_page,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .eq('archived', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const participantsMap = await loadParticipantsForSessions([data.id], groupRowId);
      return { type: data.session_type, session: toLegacySessionBlob(data, participantsMap[data.id] || null) };
    },
    saveSession:    async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const sessionId = await upsertSessionRow(gid, type, s, false);
      await upsertSessionParticipants(sessionId, groupRowId, s);
    },
    // Granular writes: persist a SINGLE participant row without rewriting the
    // session blob. Resolves the session id read-only (falling back to a create
    // only if the row does not exist yet), so concurrent hot-path clicks can no
    // longer clobber session-level blob fields.
    saveParticipant: async (groupId, type, s, name) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = (await findGroupRowId(gid)) ?? (await ensureGroupRowId(gid));
      const sessionId = (await resolveSessionId(groupRowId, type)) ?? (await upsertSessionRow(gid, type, s, false));
      await upsertParticipant(sessionId, groupRowId, s, name);
    },
    removeParticipant: async (groupId, type, s, name) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = (await findGroupRowId(gid)) ?? (await ensureGroupRowId(gid));
      const sessionId = (await resolveSessionId(groupRowId, type)) ?? (await upsertSessionRow(gid, type, s, false));
      await deleteParticipant(sessionId, groupRowId, s, name);
    },
    // Atomically allocate the next group-recitation page for the active session.
    // The increment happens inside the database (UPDATE ... RETURNING), so two
    // simultaneous self-registrations always receive distinct page numbers.
    allocateGroupRecitationPage: async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = (await findGroupRowId(gid)) ?? (await ensureGroupRowId(gid));
      const sessionId = (await resolveSessionId(groupRowId, type)) ?? (await upsertSessionRow(gid, type, s, false));
      const { data, error } = await db.rpc('allocate_group_recitation_page', { p_session_id: sessionId });
      if (error) throw error;
      return Number.isInteger(data) && data > 0 ? data : 1;
    },
    // Set the group-recitation page allocator to an explicit value (session seed
    // at start, or wholesale reset during a page recalculation). No-op if the
    // session row does not exist yet.
    setGroupRecitationPageCounter: async (groupId, type, value) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;
      const sessionId = await resolveSessionId(groupRowId, type);
      if (!sessionId) return;
      const next = Number.isInteger(value) && value > 0 ? value : 1;
      const { error } = await db
        .from('sessions')
        .update({ group_recitation_next_page: next })
        .eq('id', sessionId);
      if (error) throw error;
    },
    getSessions:    async (groupId, type)  => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('sessions')
        .select('id,session_type,name,series_id,active,chat_id,widget_message_id,group_recitation_next_page,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('session_type', type)
        .eq('archived', true)
        .order('started_at', { ascending: true });
      if (error) throw error;

      const rows = data || [];
      const participantsMap = await loadParticipantsForSessions(rows.map((r) => r.id), groupRowId);
      return rows.map((row) => toLegacySessionBlob(row, participantsMap[row.id] || null));
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
        const sessionId = await upsertSessionRow(gid, type, { ...session, active: false }, true);
        await upsertSessionParticipants(sessionId, groupRowId, session);
      }
    },
    // Permanently remove a single archived session (identified by its DB row id,
    // as returned by getAllSessions) together with its attendance rows. Scoped to
    // the group so a stale/foreign id can never delete another class's session.
    deleteSession: async (groupId, sessionId) => {
      if (!sessionId) return { ok: false, reason: 'missing_id' };
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return { ok: false, reason: 'no_group' };

      const { error: partError } = await db
        .from('session_participants')
        .delete()
        .eq('session_id', sessionId);
      if (partError) throw partError;

      const { error } = await db
        .from('sessions')
        .delete()
        .eq('id', sessionId)
        .eq('group_id', groupRowId);
      if (error) throw error;
      return { ok: true };
    },
    archiveSession: async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);

      // Transition the live "current" row into its archived snapshot IN PLACE:
      // a session stays a single row that moves live -> archived. Re-keying
      // `current:*` -> `archive-live:*` frees the current slot so the next
      // /startlist of this type inserts a fresh row instead of resurrecting this
      // one. Falls back to an insert only when there is no live row to transition
      // (e.g. a session that never persisted a current row).
      const currentKey = `current:${gid}:${type}`;
      const { data: currentRow, error: findError } = await db
        .from('sessions')
        .select('id')
        .eq('group_id', groupRowId)
        .contains('metadata', { legacy_key: currentKey })
        .maybeSingle();
      if (findError) throw findError;

      let sessionId;
      if (currentRow?.id) {
        const payload = buildSessionPayload(gid, groupRowId, type, { ...s, active: false }, true);
        const { error: updateError } = await db
          .from('sessions')
          .update(payload)
          .eq('id', currentRow.id);
        if (updateError) throw updateError;
        sessionId = currentRow.id;
      } else {
        sessionId = await upsertSessionRow(gid, type, { ...s, active: false }, true);
      }
      await upsertSessionParticipants(sessionId, groupRowId, s);
    },
    // ─── Reply-prompt store (Option A) ────────────────────────────────────────
    // Force-reply prompts are keyed by the prompt message's own id so many can be
    // open per admin at once. On reply, Telegram echoes reply_to_message.message_id
    // which we look up here directly (no group/user single-slot, no blocking).
    getReplyPrompt: async (chatId, promptMsgId) => {
      const { data, error } = await db
        .from('reply_prompts')
        .select('telegram_user_id,group_id,action,host_message_id,payload,expires_at')
        .eq('chat_id', String(chatId))
        .eq('prompt_message_id', Number(promptMsgId))
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

      return {
        userId: data.telegram_user_id,
        groupId: data.group_id,
        action: data.action,
        chatId: String(chatId),
        msgId: data.host_message_id,
        promptMsgId: Number(promptMsgId),
        ...(data.payload && typeof data.payload === 'object' ? data.payload : {}),
      };
    },
    setReplyPrompt: async (chatId, promptMsgId, v) => {
      const payload = v && typeof v === 'object' ? { ...v } : {};
      const ttlMs = 60 * 60 * 1000; // abandoned prompts self-expire after 1h
      const row = {
        chat_id: String(chatId),
        prompt_message_id: Number(promptMsgId),
        telegram_user_id: payload.userId != null ? String(payload.userId) : '',
        group_id: payload.groupId != null ? String(payload.groupId) : String(chatId),
        action: payload.action ? String(payload.action) : 'unknown',
        host_message_id: Number.isInteger(payload.msgId) ? payload.msgId : null,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
        payload: {
          ...payload,
          userId: undefined,
          groupId: undefined,
          action: undefined,
          chatId: undefined,
          msgId: undefined,
          promptMsgId: undefined,
        },
      };
      const { error } = await db
        .from('reply_prompts')
        .upsert(row, { onConflict: 'chat_id,prompt_message_id' });
      if (error) throw error;
    },
    delReplyPrompt: async (chatId, promptMsgId) => {
      const { error } = await db
        .from('reply_prompts')
        .delete()
        .eq('chat_id', String(chatId))
        .eq('prompt_message_id', Number(promptMsgId));
      if (error) throw error;
    },    // Find the newest non-expired reply prompt for a chat with a given action.
    // Lets media that is NOT a reply (e.g. album items after the first) still be
    // captured into an active upload session. Newest = highest prompt id.
    getActiveReplyPrompt: async (chatId, action) => {
      const { data, error } = await db
        .from('reply_prompts')
        .select('telegram_user_id,group_id,action,host_message_id,payload,expires_at,prompt_message_id')
        .eq('chat_id', String(chatId))
        .eq('action', String(action))
        .order('prompt_message_id', { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
      return {
        userId: row.telegram_user_id,
        groupId: row.group_id,
        action: row.action,
        chatId: String(chatId),
        msgId: row.host_message_id,
        promptMsgId: Number(row.prompt_message_id),
        ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
      };
    },
    // Album (media group) caption store. Telegram puts the caption on just one
    // item of a multi-file album, and each item arrives as a separate webhook
    // invocation, so we can't pass the caption in memory. We stash it keyed by
    // media_group_id (in the reply_prompts table under an `album:` chat key, so
    // no extra schema) and every sibling item reads it back to share one name.
    setAlbumCaption: async (mediaGroupId, caption) => {
      if (!mediaGroupId || !caption) return;
      const ttlMs = 60 * 60 * 1000;
      const { error } = await db
        .from('reply_prompts')
        .upsert({
          chat_id: `album:${mediaGroupId}`,
          prompt_message_id: 0,
          telegram_user_id: '',
          group_id: `album:${mediaGroupId}`,
          action: 'materialAlbumCaption',
          host_message_id: null,
          expires_at: new Date(Date.now() + ttlMs).toISOString(),
          payload: { caption: String(caption) },
        }, { onConflict: 'chat_id,prompt_message_id' });
      if (error) throw error;
    },
    getAlbumCaption: async (mediaGroupId) => {
      if (!mediaGroupId) return null;
      const { data, error } = await db
        .from('reply_prompts')
        .select('payload,expires_at')
        .eq('chat_id', `album:${mediaGroupId}`)
        .eq('prompt_message_id', 0)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
      const caption = data.payload && typeof data.payload === 'object' ? data.payload.caption : null;
      return caption ? String(caption) : null;
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
        .select('id,session_type,name,series_id,active,chat_id,widget_message_id,group_recitation_next_page,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('archived', true)
        .order('started_at', { ascending: true });
      if (error) throw error;

      const rows = data || [];
      // Metadata-only: the history menus/lists only need session fields (type,
      // name, series, dates, counts), so we skip hydrating participants for the
      // whole archive here. Callers load a picked record's roster on demand via
      // getSessionParticipants. This keeps the panel fast and avoids the
      // PostgREST 1000-row cap that truncated the newest sessions when every
      // archived session was hydrated up front. The DB id is attached so callers
      // can request participants for a specific record.
      return rows.map((row) => ({ ...toLegacySessionBlob(row, null), id: row.id }));
    },
    // Load participants for one or more archived sessions on demand. Returns a
    // map of sessionId -> participants blob ({} when a session has no rows yet),
    // pairing with the metadata-only getAllSessions above.
    getSessionParticipants: async (groupId, sessionIds) => {
      const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean);
      if (!ids.length) return {};
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return {};
      const participantsMap = await loadParticipantsForSessions(ids, groupRowId);
      const out = {};
      for (const id of ids) out[id] = participantsMap[id]?.participants || {};
      return out;
    },
    // ── Offline classes ─────────────────────────────────────────────────────
    // A DM-only class owned by one user (no Telegram group). Backed by a groups
    // row whose telegram_chat_id is a stable synthetic key
    // (`offline:<ownerId>:<uuid>`), so a rename only touches class_name and
    // never orphans the class's members/sessions/teachers.
    createOfflineClass: async (ownerUserId, className) => {
      const owner = String(ownerUserId || '').trim();
      const name = String(className || '').trim();
      if (!owner || !name) return { ok: false, reason: 'invalid' };
      const gid = `offline:${owner}:${randomUUID()}`;
      const { data, error } = await db
        .from('groups')
        .insert({ telegram_chat_id: gid, title: name, owner_user_id: owner, class_name: name })
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') return { ok: false, reason: 'duplicate' };
        throw error;
      }
      return { ok: true, groupId: gid, rowId: data.id, name };
    },
    listOfflineClasses: async (ownerUserId) => {
      const owner = String(ownerUserId || '').trim();
      if (!owner) return [];
      const { data, error } = await db
        .from('groups')
        .select('id,telegram_chat_id,class_name')
        .eq('owner_user_id', owner)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((row) => ({
        groupId: String(row.telegram_chat_id),
        name: row.class_name || '',
        rowId: row.id,
      }));
    },
    getOfflineClass: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const { data, error } = await db
        .from('groups')
        .select('id,telegram_chat_id,class_name,owner_user_id')
        .eq('telegram_chat_id', gid)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.owner_user_id) return null;
      return {
        groupId: String(data.telegram_chat_id),
        name: data.class_name || '',
        ownerUserId: String(data.owner_user_id),
        rowId: data.id,
      };
    },
    // Resolve an offline class by its numeric groups.id (the compact, colon-safe
    // token embedded in `o:` callbacks) back to its real storage key + owner.
    getOfflineClassById: async (rowId) => {
      const id = Number(rowId);
      if (!Number.isInteger(id)) return null;
      const { data, error } = await db
        .from('groups')
        .select('id,telegram_chat_id,class_name,owner_user_id')
        .eq('id', id)
        .not('owner_user_id', 'is', null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        groupId: String(data.telegram_chat_id),
        name: data.class_name || '',
        ownerUserId: String(data.owner_user_id),
        rowId: data.id,
      };
    },
    renameOfflineClass: async (groupId, newName) => {
      const gid = normalizeGroupId(groupId);
      const name = String(newName || '').trim();
      if (!name) return { ok: false, reason: 'invalid' };
      const { error } = await db
        .from('groups')
        .update({ class_name: name, title: name })
        .eq('telegram_chat_id', gid)
        .not('owner_user_id', 'is', null);
      if (error) {
        if (error.code === '23505') return { ok: false, reason: 'duplicate' };
        throw error;
      }
      return { ok: true, name };
    },

    // Copy a class the caller only helps manage (a shared class) into a brand-new
    // class she owns: same title (disambiguated if she already owns one by that
    // name), same roster + teachers. Attendance sessions are NOT copied — those
    // belong to the original owner's records; the clone starts fresh.
    cloneOfflineClass: async (sourceRowId, newOwnerUserId) => {
      const owner = String(newOwnerUserId || '').trim();
      const srcId = Number(sourceRowId);
      if (!owner || !Number.isInteger(srcId)) return { ok: false, reason: 'invalid' };

      const { data: src, error: srcErr } = await db
        .from('groups')
        .select('id,class_name')
        .eq('id', srcId)
        .not('owner_user_id', 'is', null)
        .maybeSingle();
      if (srcErr) throw srcErr;
      if (!src) return { ok: false, reason: 'not_found' };

      const { data: members, error: mErr } = await db
        .from('members')
        .select('name,list_number')
        .eq('group_id', srcId)
        .eq('active', true)
        .order('list_number', { ascending: true });
      if (mErr) throw mErr;

      const { data: teachers, error: tErr } = await db
        .from('teachers')
        .select('name,teacher_types')
        .eq('group_id', srcId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (tErr) throw tErr;

      // class_name is unique per owner, so append a counter if she already has a
      // class by the cloned title.
      const baseName = `${src.class_name || 'صف'} (نسخة)`;
      let cloneName = baseName;
      let newRow = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        const gid = `offline:${owner}:${randomUUID()}`;
        const { data, error } = await db
          .from('groups')
          .insert({ telegram_chat_id: gid, title: cloneName, owner_user_id: owner, class_name: cloneName })
          .select('id,telegram_chat_id')
          .single();
        if (!error) { newRow = data; break; }
        if (error.code === '23505') { cloneName = `${baseName} ${attempt + 2}`; continue; }
        throw error;
      }
      if (!newRow) return { ok: false, reason: 'duplicate' };

      const newRowId = newRow.id;
      if (members && members.length) {
        const payload = members.map((m, i) => ({
          group_id: newRowId,
          telegram_user_id: `offline:${randomUUID()}`,
          name: m.name,
          active: true,
          list_number: i + 1,
        }));
        const { error } = await db.from('members').insert(payload);
        if (error) throw error;
      }
      if (teachers && teachers.length) {
        const payload = teachers.map((t) => ({
          group_id: newRowId,
          telegram_user_id: `offline:${randomUUID()}`,
          name: t.name,
          teacher_types: t.teacher_types,
          active: true,
        }));
        const { error } = await db.from('teachers').insert(payload);
        if (error) throw error;
      }

      return {
        ok: true,
        rowId: newRowId,
        groupId: String(newRow.telegram_chat_id),
        name: cloneName,
        students: members?.length || 0,
        teachers: teachers?.length || 0,
      };
    },

    // ── Delegation (co-managers) ─────────────────────────────────────────────
    // An offline class can be shared with other users so they can help manage it
    // from their own DMs. The owner stays groups.owner_user_id; delegates live in
    // class_managers, keyed by the numeric groups.id (rowId) + their user id.

    // Resolve a class by numeric groups.id and the caller's role on it, gating
    // every offline action. Returns null if the class isn't offline or the
    // caller is neither owner nor a delegate.
    resolveManageableClass: async (rowId, userId) => {
      const id = Number(rowId);
      if (!Number.isInteger(id)) return null;
      const uid = String(userId || '').trim();
      const { data: g, error } = await db
        .from('groups')
        .select('id,telegram_chat_id,class_name,owner_user_id')
        .eq('id', id)
        .not('owner_user_id', 'is', null)
        .maybeSingle();
      if (error) throw error;
      if (!g) return null;
      const base = {
        groupId: String(g.telegram_chat_id),
        name: g.class_name || '',
        ownerUserId: String(g.owner_user_id),
        rowId: g.id,
      };
      if (uid && uid === String(g.owner_user_id)) return { ...base, role: 'owner' };
      const { data: m, error: e2 } = await db
        .from('class_managers')
        .select('manager_role, display_name')
        .eq('group_id', id)
        .eq('user_id', uid)
        .maybeSingle();
      if (e2) throw e2;
      if (!m) return null;
      return { ...base, role: m.manager_role, displayName: m.display_name || null };
    },

    // Telegram user ids to notify for a class: the owner plus every operator
    // delegate (assistants are read-only, so they're excluded). Used to alert
    // staff when a student submits homework via DM.
    listClassStaffUserIds: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const { data: g, error } = await db
        .from('groups')
        .select('id,owner_user_id')
        .eq('telegram_chat_id', gid)
        .maybeSingle();
      if (error) throw error;
      if (!g) return [];
      const ids = new Set();
      if (g.owner_user_id) ids.add(String(g.owner_user_id));
      const { data: managers, error: e2 } = await db
        .from('class_managers')
        .select('user_id, manager_role')
        .eq('group_id', g.id)
        .eq('manager_role', 'operator');
      if (e2) throw e2;
      for (const row of managers || []) if (row.user_id) ids.add(String(row.user_id));
      return [...ids];
    },

    // Every class shared with a delegate (excludes classes she owns).
    listSharedClasses: async (userId) => {
      const uid = String(userId || '').trim();
      if (!uid) return [];
      const { data: rows, error } = await db
        .from('class_managers')
        .select('group_id, manager_role')
        .eq('user_id', uid);
      if (error) throw error;
      const ids = (rows || []).map((r) => r.group_id);
      if (!ids.length) return [];
      const { data: groups, error: e2 } = await db
        .from('groups')
        .select('id,telegram_chat_id,class_name,owner_user_id')
        .in('id', ids)
        .not('owner_user_id', 'is', null);
      if (e2) throw e2;
      const roleById = new Map((rows || []).map((r) => [r.group_id, r.manager_role]));
      return (groups || [])
        .map((g) => ({
          groupId: String(g.telegram_chat_id),
          name: g.class_name || '',
          rowId: g.id,
          role: roleById.get(g.id) || 'operator',
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    },

    listClassManagers: async (rowId) => {
      const id = Number(rowId);
      if (!Number.isInteger(id)) return [];
      const { data, error } = await db
        .from('class_managers')
        .select('user_id, manager_role, display_name, added_by, created_at')
        .eq('group_id', id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((row) => ({
        userId: String(row.user_id),
        role: row.manager_role,
        displayName: row.display_name || null,
        addedBy: row.added_by != null ? String(row.added_by) : null,
      }));
    },

    addClassManager: async (rowId, userId, role, addedBy, displayName = null) => {
      const id = Number(rowId);
      const uid = String(userId || '').trim();
      if (!Number.isInteger(id) || !uid) return { ok: false, reason: 'invalid' };
      const managerRole = role === 'assistant' ? 'assistant' : 'operator';
      const row = {
        group_id: id,
        user_id: uid,
        manager_role: managerRole,
        added_by: addedBy != null ? String(addedBy) : null,
      };
      const name = displayName != null ? String(displayName).trim() : '';
      if (name) row.display_name = name;
      const { error } = await db
        .from('class_managers')
        .upsert(row, { onConflict: 'group_id,user_id' });
      if (error) throw error;
      return { ok: true, role: managerRole };
    },

    setClassManagerRole: async (rowId, userId, role) => {
      const id = Number(rowId);
      const uid = String(userId || '').trim();
      const managerRole = role === 'assistant' ? 'assistant' : 'operator';
      const { data, error } = await db
        .from('class_managers')
        .update({ manager_role: managerRole })
        .eq('group_id', id)
        .eq('user_id', uid)
        .select('user_id')
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ok: false, reason: 'not_found' };
      return { ok: true, role: managerRole };
    },

    // Keep a manager's stored name fresh (backfilled when she first opens a
    // shared class, since numeric-id adds start without a name).
    touchClassManagerName: async (rowId, userId, displayName) => {
      const id = Number(rowId);
      const uid = String(userId || '').trim();
      const name = displayName != null ? String(displayName).trim() : '';
      if (!Number.isInteger(id) || !uid || !name) return { ok: false, reason: 'invalid' };
      const { error } = await db
        .from('class_managers')
        .update({ display_name: name })
        .eq('group_id', id)
        .eq('user_id', uid);
      if (error) throw error;
      return { ok: true };
    },

    removeClassManager: async (rowId, userId) => {
      const id = Number(rowId);
      const uid = String(userId || '').trim();
      if (!Number.isInteger(id) || !uid) return { ok: false, reason: 'invalid' };
      const { error } = await db
        .from('class_managers')
        .delete()
        .eq('group_id', id)
        .eq('user_id', uid);
      if (error) throw error;
      return { ok: true };
    },

    // Assign the teacher for a session, or clear it with teacherRowId = null.
    assignSessionTeacher: async (groupId, sessionId, teacherRowId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return { ok: false, reason: 'no_group' };
      const { error } = await db
        .from('sessions')
        .update({ teacher_id: teacherRowId ?? null })
        .eq('id', sessionId)
        .eq('group_id', groupRowId);
      if (error) throw error;
      return { ok: true };
    },
    // Return the teacher assigned to a session ({ id, name, types }) or null.
    getSessionTeacher: async (sessionId) => {
      if (!sessionId) return null;
      const { data, error } = await db
        .from('sessions')
        .select('teacher_id, teachers:teacher_id (id,name,teacher_types)')
        .eq('id', sessionId)
        .maybeSingle();
      if (error) throw error;
      const t = data?.teachers;
      if (!t) return null;
      return { id: t.id, name: t.name, types: t.teacher_types || [] };
    },
    getTeachers: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('teachers')
        .select('id,telegram_user_id,name,teacher_types')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => ({
        id: row.id,
        userId: row.telegram_user_id,
        name: row.name,
        types: row.teacher_types || [],
      }));
    },
    // ── Weekly timetable (class_schedule) ────────────────────────────────────
    // Recurring weekly slots: a session type on a weekday (0=Sun..6=Sat) at a
    // time (HH:MM), with an optional linked teacher. Plan only — never creates
    // attendance sessions.
    listScheduleSlots: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('class_schedule')
        .select('id,session_type,day_of_week,time_of_day,teacher_id,teachers:teacher_id (id,name,teacher_types)')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('day_of_week', { ascending: true })
        .order('time_of_day', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => ({
        id: row.id,
        sessionType: row.session_type,
        dayOfWeek: row.day_of_week,
        timeOfDay: row.time_of_day,
        teacherId: row.teacher_id ?? null,
        teacherName: row.teachers?.name ?? null,
        teacherTypes: row.teachers?.teacher_types ?? null,
      }));
    },
    getScheduleSlot: async (groupId, slotId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('class_schedule')
        .select('id,session_type,day_of_week,time_of_day,teacher_id,teachers:teacher_id (id,name,teacher_types)')
        .eq('group_id', groupRowId)
        .eq('id', slotId)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        sessionType: data.session_type,
        dayOfWeek: data.day_of_week,
        timeOfDay: data.time_of_day,
        teacherId: data.teacher_id ?? null,
        teacherName: data.teachers?.name ?? null,
        teacherTypes: data.teachers?.teacher_types ?? null,
      };
    },
    addScheduleSlot: async (groupId, slot) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('class_schedule')
        .insert({
          group_id: groupRowId,
          session_type: String(slot.sessionType),
          day_of_week: Number(slot.dayOfWeek),
          time_of_day: String(slot.timeOfDay),
          teacher_id: slot.teacherId ?? null,
          active: true,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data?.id ?? null;
    },
    // Set (or clear, with null) the teacher on a slot.
    setScheduleSlotTeacher: async (groupId, slotId, teacherId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;
      const { error } = await db
        .from('class_schedule')
        .update({ teacher_id: teacherId ?? null, updated_at: nowIso() })
        .eq('group_id', groupRowId)
        .eq('id', slotId)
        .eq('active', true);
      if (error) throw error;
    },
    // Update a slot's day and/or time. Only the provided fields change.
    updateScheduleSlot: async (groupId, slotId, patch = {}) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;
      const update = { updated_at: nowIso() };
      if (patch.dayOfWeek !== undefined) update.day_of_week = Number(patch.dayOfWeek);
      if (patch.timeOfDay !== undefined) update.time_of_day = String(patch.timeOfDay);
      const { error } = await db
        .from('class_schedule')
        .update(update)
        .eq('group_id', groupRowId)
        .eq('id', slotId)
        .eq('active', true);
      if (error) throw error;
    },
    removeScheduleSlot: async (groupId, slotId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;
      const { error } = await db
        .from('class_schedule')
        .update({ active: false, updated_at: nowIso() })
        .eq('group_id', groupRowId)
        .eq('id', slotId)
        .eq('active', true);
      if (error) throw error;
    },
    // Cross-class "my week": every schedule slot across the classes this user
    // owns or co-manages, each tagged with its class name. Flat + sorted by
    // day/time so the week view can group by day.
    listScheduleForUser: async (userId) => {
      const uid = String(userId || '').trim();
      if (!uid) return [];
      const { data: owned, error: e1 } = await db
        .from('groups')
        .select('id,class_name')
        .eq('owner_user_id', uid);
      if (e1) throw e1;
      const { data: managed, error: e2 } = await db
        .from('class_managers')
        .select('group_id, groups:group_id (id,class_name)')
        .eq('user_id', uid);
      if (e2) throw e2;

      // Classes the user is enrolled in as a student (so students can view too).
      const { data: enrolled, error: e3 } = await db
        .from('members')
        .select('groups:group_id (id,class_name,owner_user_id)')
        .eq('telegram_user_id', uid)
        .eq('active', true);
      if (e3) throw e3;

      const byId = new Map();
      for (const g of owned || []) byId.set(g.id, g.class_name || '');
      for (const m of managed || []) {
        if (m.groups?.id != null) byId.set(m.groups.id, m.groups.class_name || '');
      }
      for (const e of enrolled || []) {
        if (e.groups?.id != null && e.groups?.owner_user_id != null) {
          byId.set(e.groups.id, e.groups.class_name || '');
        }
      }
      const ids = [...byId.keys()];
      if (!ids.length) return [];

      const { data, error } = await db
        .from('class_schedule')
        .select('id,group_id,session_type,day_of_week,time_of_day,teachers:teacher_id (name)')
        .in('group_id', ids)
        .eq('active', true)
        .order('day_of_week', { ascending: true })
        .order('time_of_day', { ascending: true });
      if (error) throw error;

      // Timezone per class, so each cross-class line can show its own local time.
      const { data: tzRows, error: tzErr } = await db
        .from('group_settings')
        .select('group_id,timezone')
        .in('group_id', ids);
      if (tzErr) throw tzErr;
      const tzById = new Map();
      for (const r of tzRows || []) tzById.set(r.group_id, r.timezone || 'Africa/Cairo');

      return (data || []).map((row) => ({
        id: row.id,
        groupId: row.group_id,
        className: byId.get(row.group_id) || '',
        sessionType: row.session_type,
        dayOfWeek: row.day_of_week,
        timeOfDay: row.time_of_day,
        teacherName: row.teachers?.name ?? null,
        timezone: tzById.get(row.group_id) || 'Africa/Cairo',
      }));
    },
    // Class timezone (IANA) the weekly timetable times are expressed in.
    getClassTimezone: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return 'Africa/Cairo';
      const { data, error } = await db
        .from('group_settings')
        .select('timezone')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      return data?.timezone || 'Africa/Cairo';
    },
    setClassTimezone: async (groupId, timezone) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const { error } = await db
        .from('group_settings')
        .upsert({ group_id: groupRowId, timezone: String(timezone) }, { onConflict: 'group_id' });
      if (error) throw error;
    },
    // Per-viewer display preferences for the weekly timetable. timezone null =
    // follow each class's own timezone (no conversion); weekStart 0=Sun..6=Sat.
    getUserPrefs: async (userId) => {
      const uid = String(userId || '').trim();
      if (!uid) return { timezone: null, weekStart: 6 };
      const { data, error } = await db
        .from('user_prefs')
        .select('timezone,week_start')
        .eq('user_id', uid)
        .maybeSingle();
      if (error) throw error;
      return {
        timezone: data?.timezone ?? null,
        weekStart: data?.week_start ?? 6,
      };
    },
    setUserTimezone: async (userId, timezone) => {
      const uid = String(userId || '').trim();
      if (!uid) return;
      const { error } = await db
        .from('user_prefs')
        .upsert(
          { user_id: uid, timezone: timezone ? String(timezone) : null, updated_at: nowIso() },
          { onConflict: 'user_id' },
        );
      if (error) throw error;
    },
    setUserWeekStart: async (userId, weekStart) => {
      const uid = String(userId || '').trim();
      if (!uid) return;
      const n = Number(weekStart);
      if (!Number.isInteger(n) || n < 0 || n > 6) return;
      const { error } = await db
        .from('user_prefs')
        .upsert(
          { user_id: uid, week_start: n, updated_at: nowIso() },
          { onConflict: 'user_id' },
        );
      if (error) throw error;
    },

    saveTeachers: async (groupId, teachers) => {
      const gid = normalizeGroupId(groupId);
      const next = Array.isArray(teachers) ? teachers : [];

      const byUser = new Map();
      for (const row of next) {
        if (!row?.userId || !row?.name || !Array.isArray(row?.types) || !row.types.length) continue;
        byUser.set(String(row.userId), {
          group_id: null,
          telegram_user_id: String(row.userId),
          name: String(row.name),
          teacher_types: row.types.map((t) => String(t)),
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
    // Teaching materials: a "material" is a lesson (a title) that owns one or
    // more files. The lesson lives in class_materials; its files live in
    // class_material_files. We persist only Telegram's file_id (Telegram hosts
    // the bytes); the same file_id is later reused to resend the files. The
    // lesson is soft-deleted (active=false) so history stays intact; its files
    // cascade-delete only if the lesson row is ever hard-deleted.
    getMaterials: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('class_materials')
        .select('id,title,added_by,created_at,class_material_files(id,file_id,file_type,file_name,position)')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => mapMaterialRow(row));
    },
    getMaterialById: async (groupId, materialId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('class_materials')
        .select('id,title,added_by,created_at,class_material_files(id,file_id,file_type,file_name,position)')
        .eq('group_id', groupRowId)
        .eq('id', materialId)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return mapMaterialRow(data);
    },
    // Create a lesson (no files yet). Files are attached via addMaterialFile.
    // When the lesson comes from a Telegram album, its items arrive as separate,
    // possibly concurrent webhook calls that each try to create the lesson; we
    // upsert on the shared media_group_id so they all resolve to ONE row instead
    // of racing to create duplicates.
    addMaterial: async (groupId, material) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const mediaGroupId = material.mediaGroupId ? String(material.mediaGroupId) : null;

      const payload = {
        group_id: groupRowId,
        title: String(material.title),
        added_by: material.addedBy ? String(material.addedBy) : null,
        active: true,
        media_group_id: mediaGroupId,
      };

      if (mediaGroupId) {
        // ignoreDuplicates: the first invocation inserts and gets the row back;
        // losers of the race get an empty result and re-read the winning row.
        const { data, error } = await db
          .from('class_materials')
          .upsert(payload, { onConflict: 'media_group_id', ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        if (data && data[0]) return data[0].id;
        const { data: existing, error: exError } = await db
          .from('class_materials')
          .select('id')
          .eq('media_group_id', mediaGroupId)
          .limit(1);
        if (exError) throw exError;
        return existing?.[0]?.id ?? null;
      }

      const { data, error } = await db
        .from('class_materials')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data?.id ?? null;
    },
    // Append a file to a lesson at the next position. Returns the new file id.
    addMaterialFile: async (materialId, file) => {
      const { data: existing, error: posError } = await db
        .from('class_material_files')
        .select('position')
        .eq('material_id', materialId)
        .order('position', { ascending: false })
        .limit(1);
      if (posError) throw posError;
      const nextPosition = (existing?.[0]?.position ?? 0) + 1;

      const payload = {
        material_id: materialId,
        file_id: String(file.fileId),
        file_type: String(file.fileType),
        file_name: file.fileName ? String(file.fileName) : null,
        position: nextPosition,
        media_group_id: file.mediaGroupId ? String(file.mediaGroupId) : null,
      };

      const { data, error } = await db
        .from('class_material_files')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data?.id ?? null;
    },
    // Back-fill one name onto every file of an album (media group) within a
    // lesson. Album items arrive as separate webhook calls with the caption on
    // only one of them, so whichever item carries the caption stamps the shared
    // name onto its siblings — covering siblings that were saved before it ran.
    renameAlbumFiles: async (materialId, mediaGroupId, name) => {
      if (!materialId || !mediaGroupId || !name) return;
      const { error } = await db
        .from('class_material_files')
        .update({ file_name: String(name) })
        .eq('material_id', materialId)
        .eq('media_group_id', String(mediaGroupId));
      if (error) throw error;
    },
    // Back-fill the lesson title from the album's caption. Scoped to
    // media_group_id so it only touches a lesson that was CREATED from this
    // album (its media_group_id matches) — adding files to an existing lesson
    // (whose media_group_id is null or from a different album) never renames it.
    renameAlbumMaterial: async (materialId, mediaGroupId, title) => {
      if (!materialId || !mediaGroupId || !title) return;
      const { error } = await db
        .from('class_materials')
        .update({ title: String(title) })
        .eq('id', materialId)
        .eq('media_group_id', String(mediaGroupId));
      if (error) throw error;
    },
    removeMaterial: async (groupId, materialId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const { error } = await db
        .from('class_materials')
        .update({ active: false })
        .eq('group_id', groupRowId)
        .eq('id', materialId)
        .eq('active', true);
      if (error) throw error;
    },
    // Hard-delete a single file from a lesson (the other files stay). Scoped to
    // the group + lesson so a stray file id can't be deleted from elsewhere.
    removeMaterialFile: async (groupId, materialId, fileId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const { data: owner, error: ownError } = await db
        .from('class_materials')
        .select('id')
        .eq('group_id', groupRowId)
        .eq('id', materialId)
        .eq('active', true)
        .maybeSingle();
      if (ownError) throw ownError;
      if (!owner) return;

      const { error } = await db
        .from('class_material_files')
        .delete()
        .eq('material_id', materialId)
        .eq('id', fileId);
      if (error) throw error;
    },
    renameMaterial: async (groupId, materialId, title) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const { error } = await db
        .from('class_materials')
        .update({ title: String(title) })
        .eq('group_id', groupRowId)
        .eq('id', materialId)
        .eq('active', true);
      if (error) throw error;
    },
    // Rename a single file within a lesson. Scoped through the owning lesson so
    // a stray file id can't be renamed from another group's lesson.
    renameMaterialFile: async (groupId, materialId, fileId, name) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const { data: owner, error: ownError } = await db
        .from('class_materials')
        .select('id')
        .eq('group_id', groupRowId)
        .eq('id', materialId)
        .eq('active', true)
        .maybeSingle();
      if (ownError) throw ownError;
      if (!owner) return;

      const { error } = await db
        .from('class_material_files')
        .update({ file_name: name ? String(name) : null })
        .eq('material_id', materialId)
        .eq('id', fileId);
      if (error) throw error;
    },
    // ─── Homework tracking ──────────────────────────────────────────────────
    // A main group can link one dedicated homework group. The link is stored on
    // group_settings.homework_group_id (Telegram chat id) and mirrored by the
    // homework group's own groups.parent_group_id, so both directions resolve.
    getHomeworkGroupId: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('group_settings')
        .select('homework_group_id')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      return data?.homework_group_id ? String(data.homework_group_id) : null;
    },
    setHomeworkGroup: async (mainGroupId, homeworkGroupId) => {
      const mainGid = normalizeGroupId(mainGroupId);
      const hwGid = normalizeGroupId(homeworkGroupId);
      const mainRowId = await ensureGroupRowId(mainGid);
      const hwRowId = await ensureGroupRowId(hwGid);

      const { error } = await db
        .from('group_settings')
        .upsert({ group_id: mainRowId, homework_group_id: hwGid }, { onConflict: 'group_id' });
      if (error) throw error;

      const { error: parentError } = await db
        .from('groups')
        .update({ parent_group_id: mainRowId })
        .eq('id', hwRowId);
      if (parentError) throw parentError;
    },
    removeHomeworkGroup: async (mainGroupId) => {
      const mainGid = normalizeGroupId(mainGroupId);
      const mainRowId = await findGroupRowId(mainGid);
      if (!mainRowId) return;

      // Clear the linked homework group's parent pointer first (before we lose
      // the reference), then drop the link on group_settings.
      const { data: settings, error: readError } = await db
        .from('group_settings')
        .select('homework_group_id')
        .eq('group_id', mainRowId)
        .maybeSingle();
      if (readError) throw readError;

      const hwGid = settings?.homework_group_id ? String(settings.homework_group_id) : null;
      if (hwGid) {
        const hwRowId = await findGroupRowId(hwGid);
        if (hwRowId) {
          const { error: parentError } = await db
            .from('groups')
            .update({ parent_group_id: null })
            .eq('id', hwRowId);
          if (parentError) throw parentError;
        }
      }

      const { error } = await db
        .from('group_settings')
        .update({ homework_group_id: null })
        .eq('group_id', mainRowId);
      if (error) throw error;
    },
    // Given an incoming homework-group chat id, resolve the MAIN class it belongs
    // to (authoritative: matches group_settings.homework_group_id). Returns the
    // main class's Telegram chat id + row id, or null when not a homework group.
    resolveHomeworkMainGroup: async (homeworkGroupId) => {
      const hwGid = normalizeGroupId(homeworkGroupId);
      const { data, error } = await db
        .from('group_settings')
        .select('group_id')
        .eq('homework_group_id', hwGid)
        .maybeSingle();
      if (error) throw error;
      if (!data?.group_id) return null;

      const { data: main, error: mainError } = await db
        .from('groups')
        .select('telegram_chat_id')
        .eq('id', data.group_id)
        .maybeSingle();
      if (mainError) throw mainError;
      if (!main?.telegram_chat_id) return null;
      return { mainGroupId: String(main.telegram_chat_id), mainRowId: data.group_id };
    },
    getHomework: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('homework')
        .select('id,title,content,source_message_id,posted_by,created_at,homework_files(id,file_id,file_type,file_name,position)')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => mapHomeworkRow(row));
    },
    getHomeworkById: async (groupId, homeworkId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('homework')
        .select('id,title,content,source_message_id,posted_by,created_at,homework_files(id,file_id,file_type,file_name,position)')
        .eq('group_id', groupRowId)
        .eq('id', homeworkId)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return mapHomeworkRow(data);
    },
    // Resolve a homework item by the Telegram message a student replied to (the
    // assignment post). Group flow only (offline items have no source message).
    getHomeworkBySourceMessage: async (groupId, sourceMessageId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('homework')
        .select('id,title,source_message_id,posted_by,created_at')
        .eq('group_id', groupRowId)
        .eq('source_message_id', sourceMessageId)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        title: data.title,
        sourceMessageId: data.source_message_id ?? null,
        postedBy: data.posted_by || null,
        createdAt: data.created_at || null,
      };
    },
    addHomework: async (groupId, homework) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);

      const payload = {
        group_id: groupRowId,
        title: String(homework.title),
        source_message_id: homework.sourceMessageId ?? null,
        posted_by: homework.postedBy ? String(homework.postedBy) : null,
        active: true,
      };

      const { data, error } = await db
        .from('homework')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data?.id ?? null;
    },
    removeHomework: async (groupId, homeworkId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const { error } = await db
        .from('homework')
        .update({ active: false })
        .eq('group_id', groupRowId)
        .eq('id', homeworkId)
        .eq('active', true);
      if (error) throw error;
    },
    // Rename a homework item's title. Mirrors renameMaterial.
    renameHomework: async (groupId, homeworkId, title) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const { error } = await db
        .from('homework')
        .update({ title: String(title), updated_at: nowIso() })
        .eq('group_id', groupRowId)
        .eq('id', homeworkId)
        .eq('active', true);
      if (error) throw error;
    },
    // Append a media file to a homework item at the next position. Returns the
    // new file id. Mirrors addMaterialFile.
    addHomeworkFile: async (homeworkId, file) => {
      const { data: existing, error: posError } = await db
        .from('homework_files')
        .select('position')
        .eq('homework_id', homeworkId)
        .order('position', { ascending: false })
        .limit(1);
      if (posError) throw posError;
      const nextPosition = (existing?.[0]?.position ?? 0) + 1;

      const payload = {
        homework_id: homeworkId,
        file_id: String(file.fileId),
        file_type: String(file.fileType),
        file_name: file.fileName ? String(file.fileName) : null,
        position: nextPosition,
      };

      const { data, error } = await db
        .from('homework_files')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data?.id ?? null;
    },
    // Set (or clear) a homework item's text body. Pass null/'' to clear.
    setHomeworkContent: async (groupId, homeworkId, content) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return;

      const trimmed = content ? String(content).trim() : '';
      const { error } = await db
        .from('homework')
        .update({ content: trimmed || null, updated_at: new Date().toISOString() })
        .eq('group_id', groupRowId)
        .eq('id', homeworkId)
        .eq('active', true);
      if (error) throw error;
    },
    // Find an active member by Telegram user id (maps a replier to member_id).
    findMemberByUserId: async (groupId, userId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return null;

      const { data, error } = await db
        .from('members')
        .select('id,name')
        .eq('group_id', groupRowId)
        .eq('telegram_user_id', String(userId))
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, name: data.name };
    },
    // The active roster with DB row ids (member_id). Used by the offline homework
    // panel to toggle submission/review state per student (getMaster only exposes
    // telegram_user_id, but submissions key on the member row id).
    getMembersWithIds: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('members')
        .select('id,name,telegram_user_id,list_number')
        .eq('group_id', groupRowId)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        userId: row.telegram_user_id ?? null,
        listNumber: row.list_number ?? null,
      }));
    },
    // Upsert a submission for (homework, member). Idempotent: a re-submission
    // keeps the earliest submitted_at but refreshes the message pointer. If the
    // member had already been reviewed, submitting again flags resubmitted (the
    // student redid the work after feedback, awaiting re-review).
    recordSubmission: async (homeworkId, memberId, submissionMessageId = null) => {
      const { data: existing, error: readError } = await db
        .from('homework_submissions')
        .select('id,reviewed')
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .maybeSingle();
      if (readError) throw readError;

      if (existing?.id) {
        const update = {};
        if (submissionMessageId !== null) update.submission_message_id = submissionMessageId;
        if (existing.reviewed) {
          update.resubmitted = true;
          update.resubmitted_at = nowIso();
        }
        if (Object.keys(update).length) {
          const { error: updateError } = await db
            .from('homework_submissions')
            .update(update)
            .eq('id', existing.id);
          if (updateError) throw updateError;
        }
        return existing.id;
      }

      const { data, error } = await db
        .from('homework_submissions')
        .insert({
          homework_id: homeworkId,
          member_id: memberId,
          submission_message_id: submissionMessageId,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data?.id ?? null;
    },
    // Toggle a submission on/off (offline manual tracking). Returns the new
    // submitted state.
    toggleSubmission: async (homeworkId, memberId) => {
      const { data: existing, error: readError } = await db
        .from('homework_submissions')
        .select('id')
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .maybeSingle();
      if (readError) throw readError;

      if (existing?.id) {
        const { error } = await db
          .from('homework_submissions')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
        return false;
      }

      const { error } = await db
        .from('homework_submissions')
        .insert({ homework_id: homeworkId, member_id: memberId });
      if (error) throw error;
      return true;
    },
    // Mark a submission reviewed by message pointer (a homework teacher replied
    // to the student's submission). Matches an unreviewed submission OR a
    // resubmitted one (re-review), clearing the resubmitted flag. Returns true
    // when a row was updated.
    markReviewedByMessage: async (submissionMessageId, reviewerUserId) => {
      const { data, error } = await db
        .from('homework_submissions')
        .update({
          reviewed: true,
          resubmitted: false,
          reviewed_by: reviewerUserId ? String(reviewerUserId) : null,
          reviewed_at: nowIso(),
        })
        .eq('submission_message_id', submissionMessageId)
        .or('reviewed.eq.false,resubmitted.eq.true')
        .select('id');
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
    // Toggle the reviewed flag for (homework, member) (offline manual tracking).
    // Creates the submission first if needed. Returns the new reviewed state.
    toggleReviewed: async (homeworkId, memberId, reviewerUserId = null) => {
      const { data: existing, error: readError } = await db
        .from('homework_submissions')
        .select('id,reviewed')
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .maybeSingle();
      if (readError) throw readError;

      if (!existing?.id) {
        const { error } = await db
          .from('homework_submissions')
          .insert({
            homework_id: homeworkId,
            member_id: memberId,
            reviewed: true,
            reviewed_by: reviewerUserId ? String(reviewerUserId) : null,
            reviewed_at: nowIso(),
          });
        if (error) throw error;
        return true;
      }

      const next = !existing.reviewed;
      const { error } = await db
        .from('homework_submissions')
        .update({
          reviewed: next,
          reviewed_by: next && reviewerUserId ? String(reviewerUserId) : null,
          reviewed_at: next ? nowIso() : null,
        })
        .eq('id', existing.id);
      if (error) throw error;
      return next;
    },
    getSubmissions: async (homeworkId) => {
      const { data, error } = await db
        .from('homework_submissions')
        .select('id,member_id,submission_message_id,content,file_id,file_type,teacher_reply,teacher_reply_at,submitted_at,reviewed,reviewed_by,reviewed_at,resubmitted,resubmitted_at,members(name)')
        .eq('homework_id', homeworkId)
        .order('submitted_at', { ascending: true });
      if (error) throw error;

      return (data || []).map((row) => ({
        id: row.id,
        memberId: row.member_id ?? null,
        memberName: row.members?.name ?? null,
        submissionMessageId: row.submission_message_id ?? null,
        content: row.content ?? null,
        fileId: row.file_id ?? null,
        fileType: row.file_type ?? null,
        teacherReply: row.teacher_reply ?? null,
        teacherReplyAt: row.teacher_reply_at ?? null,
        submittedAt: row.submitted_at ?? null,
        reviewed: Boolean(row.reviewed),
        reviewedBy: row.reviewed_by ?? null,
        reviewedAt: row.reviewed_at ?? null,
        resubmitted: Boolean(row.resubmitted),
        resubmittedAt: row.resubmitted_at ?? null,
      }));
    },
    // Set a (homework, member) submission to an exact state (offline manual
    // tracking). state ∈ 'none' | 'submitted' | 'reviewed' | 'resubmitted'.
    // 'none' deletes the row; the others upsert the matching flags.
    setSubmissionState: async (homeworkId, memberId, state, actorUserId = null) => {
      const { data: existing, error: readError } = await db
        .from('homework_submissions')
        .select('id')
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .maybeSingle();
      if (readError) throw readError;

      if (state === 'none') {
        if (existing?.id) {
          const { error } = await db
            .from('homework_submissions')
            .delete()
            .eq('id', existing.id);
          if (error) throw error;
        }
        return;
      }

      const reviewer = actorUserId ? String(actorUserId) : null;
      const fields = {
        reviewed: state === 'reviewed' || state === 'resubmitted',
        resubmitted: state === 'resubmitted',
        reviewed_by: state === 'reviewed' || state === 'resubmitted' ? reviewer : null,
        reviewed_at: state === 'reviewed' || state === 'resubmitted' ? nowIso() : null,
        resubmitted_at: state === 'resubmitted' ? nowIso() : null,
      };

      if (existing?.id) {
        const { error } = await db
          .from('homework_submissions')
          .update(fields)
          .eq('id', existing.id);
        if (error) throw error;
        return;
      }

      const { error } = await db
        .from('homework_submissions')
        .insert({ homework_id: homeworkId, member_id: memberId, ...fields });
      if (error) throw error;
    },
    // ── Student self-service homework (DM loop) ──────────────────────────────
    // Link a roster member (by list number) to the student's Telegram user id,
    // so a DM from that account resolves to this member. `rowId` is the numeric
    // groups.id (as carried in the join deep link). Refuses if the slot is
    // already linked to a different account. Returns { id, name, groupId } or null.
    linkStudentUser: async (rowId, listNumber, userId) => {
      const id = Number(rowId);
      if (!Number.isInteger(id)) return null;
      const { data: g, error: gErr } = await db
        .from('groups')
        .select('id,telegram_chat_id,owner_user_id')
        .eq('id', id)
        .not('owner_user_id', 'is', null)
        .maybeSingle();
      if (gErr) throw gErr;
      if (!g) return null;

      const { data: member, error } = await db
        .from('members')
        .select('id,name,telegram_user_id')
        .eq('group_id', id)
        .eq('list_number', listNumber)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      if (!member) return null;
      // Already linked to someone else → refuse (don't hijack a slot).
      if (member.telegram_user_id && String(member.telegram_user_id) !== String(userId)) return null;

      if (String(member.telegram_user_id || '') !== String(userId)) {
        const { error: upError } = await db
          .from('members')
          .update({ telegram_user_id: String(userId) })
          .eq('id', member.id);
        if (upError) throw upError;
      }
      return { id: member.id, name: member.name, groupId: String(g.telegram_chat_id) };
    },
    // All offline classes where this Telegram user is a linked roster member.
    // Returns [{ groupId, rowId, className, memberId, memberName }].
    listStudentClasses: async (userId) => {
      const { data, error } = await db
        .from('members')
        .select('id,name,group_id,groups!inner(id,telegram_chat_id,class_name,owner_user_id)')
        .eq('telegram_user_id', String(userId))
        .eq('active', true)
        .not('groups.owner_user_id', 'is', null);
      if (error) throw error;

      return (data || []).map((row) => ({
        groupId: String(row.groups.telegram_chat_id),
        rowId: row.groups.id,
        className: row.groups.class_name || '',
        memberId: row.id,
        memberName: row.name,
      }));
    },
    // One (homework, member) submission row, or null. Used by the student DM
    // view and the teacher's submission detail.
    getSubmissionForMember: async (homeworkId, memberId) => {
      const { data, error } = await db
        .from('homework_submissions')
        .select('id,member_id,submission_message_id,content,file_id,file_type,teacher_reply,teacher_reply_at,submitted_at,reviewed,reviewed_by,reviewed_at,resubmitted,resubmitted_at')
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        memberId: data.member_id ?? null,
        submissionMessageId: data.submission_message_id ?? null,
        content: data.content ?? null,
        fileId: data.file_id ?? null,
        fileType: data.file_type ?? null,
        teacherReply: data.teacher_reply ?? null,
        teacherReplyAt: data.teacher_reply_at ?? null,
        submittedAt: data.submitted_at ?? null,
        reviewed: Boolean(data.reviewed),
        reviewedBy: data.reviewed_by ?? null,
        reviewedAt: data.reviewed_at ?? null,
        resubmitted: Boolean(data.resubmitted),
        resubmittedAt: data.resubmitted_at ?? null,
      };
    },
    // A student submits (or resubmits) homework via DM. Upserts the submission
    // with its content/file. If it had already been reviewed, this is a
    // resubmission (awaiting re-review) → resubmitted=true. A fresh submission
    // clears any prior teacher reply. Returns { id, resubmitted }.
    submitStudentHomework: async (homeworkId, memberId, payload = {}) => {
      const { content = null, fileId = null, fileType = null } = payload;
      const { data: existing, error: readError } = await db
        .from('homework_submissions')
        .select('id,reviewed')
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .maybeSingle();
      if (readError) throw readError;

      const base = {
        content: content ? String(content) : null,
        file_id: fileId ? String(fileId) : null,
        file_type: fileType ? String(fileType) : null,
        teacher_reply: null,
        teacher_reply_at: null,
        updated_at: nowIso(),
      };

      if (existing?.id) {
        const resubmitted = Boolean(existing.reviewed);
        const { error } = await db
          .from('homework_submissions')
          .update({
            ...base,
            resubmitted,
            resubmitted_at: resubmitted ? nowIso() : null,
          })
          .eq('id', existing.id);
        if (error) throw error;
        return { id: existing.id, resubmitted };
      }

      const { data, error } = await db
        .from('homework_submissions')
        .insert({
          homework_id: homeworkId,
          member_id: memberId,
          submitted_at: nowIso(),
          ...base,
        })
        .select('id')
        .single();
      if (error) throw error;
      return { id: data?.id ?? null, resubmitted: false };
    },
    // A teacher replies to a student's submission (offline review). Stores the
    // feedback, marks it reviewed, and clears resubmitted. Returns true when a
    // row was updated.
    setTeacherReply: async (homeworkId, memberId, reply, reviewerUserId = null) => {
      const { data, error } = await db
        .from('homework_submissions')
        .update({
          teacher_reply: reply ? String(reply) : null,
          teacher_reply_at: nowIso(),
          reviewed: true,
          resubmitted: false,
          reviewed_by: reviewerUserId ? String(reviewerUserId) : null,
          reviewed_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq('homework_id', homeworkId)
        .eq('member_id', memberId)
        .select('id');
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
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
    getTrainingGroups: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];

      const { data, error } = await db
        .from('group_settings')
        .select('training_groups')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;

      const groups = Array.isArray(data?.training_groups) ? data.training_groups : [];
      return groups
        .filter((row) => row?.groupId && row?.name)
        .map((row) => ({ groupId: String(row.groupId), name: String(row.name) }));
    },
    saveTrainingGroups: async (groupId, groups) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const next = (Array.isArray(groups) ? groups : [])
        .filter((row) => row?.groupId && row?.name)
        .map((row) => ({ groupId: String(row.groupId), name: String(row.name) }));

      const { error } = await db
        .from('group_settings')
        .upsert({
          group_id: groupRowId,
          training_groups: next,
        }, { onConflict: 'group_id' });
      if (error) throw error;

    },
    // Link a (training) group to the main group that owns it. 1:1 from the
    // training side: a training group has at most one parent main group.
    setParentGroup: async (childGroupId, parentGroupId) => {
      const childGid = normalizeGroupId(childGroupId);
      const parentGid = normalizeGroupId(parentGroupId);
      const childRowId = await ensureGroupRowId(childGid);
      const parentRowId = await ensureGroupRowId(parentGid);
      const { error } = await db
        .from('groups')
        .update({ parent_group_id: parentRowId })
        .eq('id', childRowId);
      if (error) throw error;
    },
    // Return the Telegram chat id of the parent (main) group for a training
    // group, or null when the group has no parent.
    getParentGroupId: async (childGroupId) => {
      const childGid = normalizeGroupId(childGroupId);
      const { data, error } = await db
        .from('groups')
        .select('parent_group_id')
        .eq('telegram_chat_id', childGid)
        .maybeSingle();
      if (error) throw error;
      const parentRowId = data?.parent_group_id;
      if (!parentRowId) return null;

      const { data: parent, error: parentError } = await db
        .from('groups')
        .select('telegram_chat_id')
        .eq('id', parentRowId)
        .maybeSingle();
      if (parentError) throw parentError;
      return parent?.telegram_chat_id ? String(parent.telegram_chat_id) : null;
    },
    // Add members to a group WITHOUT deactivating anyone (unlike saveMaster,
    // which replaces the whole roster). Only inserts users not already active,
    // so existing members' names/state are never overwritten.
    addMembers: async (groupId, members) => {
      const gid = normalizeGroupId(groupId);
      const list = Array.isArray(members) ? members : [];

      const byUser = new Map();
      for (const row of list) {
        if (!row?.userId || !row?.name) continue;
        byUser.set(String(row.userId), { userId: String(row.userId), name: String(row.name) });
      }
      if (!byUser.size) return;

      const groupRowId = await ensureGroupRowId(gid);
      const { data: existing, error: readError } = await db
        .from('members')
        .select('telegram_user_id')
        .eq('group_id', groupRowId)
        .eq('active', true);
      if (readError) throw readError;
      const existingSet = new Set((existing || []).map((r) => String(r.telegram_user_id)));

      const payload = [...byUser.values()]
        .filter((m) => !existingSet.has(m.userId))
        .map((m) => ({
          group_id: groupRowId,
          telegram_user_id: m.userId,
          name: m.name,
          active: true,
        }));
      if (!payload.length) return;

      const { error } = await db
        .from('members')
        .upsert(payload, { onConflict: 'group_id,telegram_user_id' });
      if (error) throw error;
    },
    // Add offline students by name only. Each becomes a members row with a
    // synthetic, unique telegram_user_id (`offline:<uuid>`) since offline
    // students never have a Telegram account. Names already active (or repeated
    // within the batch) are skipped case-insensitively. list_number is assigned
    // sequentially after the current max so the roster keeps a stable order.
    // Returns { added, skipped }.
    addOfflineStudents: async (groupId, names) => {
      const gid = normalizeGroupId(groupId);
      const list = (Array.isArray(names) ? names : [])
        .map((n) => String(n || '').trim())
        .filter(Boolean);
      if (!list.length) return { added: 0, skipped: 0 };

      const groupRowId = await ensureGroupRowId(gid);
      const { data: existing, error: readError } = await db
        .from('members')
        .select('name,list_number')
        .eq('group_id', groupRowId)
        .eq('active', true);
      if (readError) throw readError;

      const existingNames = new Set((existing || []).map((r) => String(r.name).toLowerCase()));
      let nextListNumber = (existing || [])
        .reduce((max, r) => Math.max(max, r.list_number || 0), 0) + 1;

      const seen = new Set();
      const payload = [];
      let skipped = 0;
      for (const name of list) {
        const key = name.toLowerCase();
        if (existingNames.has(key) || seen.has(key)) { skipped += 1; continue; }
        seen.add(key);
        payload.push({
          group_id: groupRowId,
          telegram_user_id: `offline:${randomUUID()}`,
          name,
          active: true,
          list_number: nextListNumber++,
        });
      }

      if (payload.length) {
        const { error } = await db.from('members').insert(payload);
        if (error) throw error;
      }
      return { added: payload.length, skipped };
    },
    // Rename an offline student, addressed by its stable list_number (colon-free,
    // unlike the synthetic telegram_user_id). Returns { ok, name } or
    // { ok:false } when the student can't be found / the name is invalid.
    renameOfflineStudent: async (groupId, listNumber, newName) => {
      const gid = normalizeGroupId(groupId);
      const name = String(newName || '').trim();
      const ln = Number(listNumber);
      if (!name || !Number.isFinite(ln)) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('members')
        .update({ name })
        .eq('group_id', groupRowId)
        .eq('list_number', ln)
        .eq('active', true)
        .select('name');
      if (error) throw error;
      if (!data || !data.length) return { ok: false };
      return { ok: true, name };
    },
    // Soft-delete an offline student (active=false) so their past attendance
    // records stay intact. Addressed by list_number. Returns { ok, name }.
    removeOfflineStudent: async (groupId, listNumber) => {
      const gid = normalizeGroupId(groupId);
      const ln = Number(listNumber);
      if (!Number.isFinite(ln)) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('members')
        .update({ active: false })
        .eq('group_id', groupRowId)
        .eq('list_number', ln)
        .eq('active', true)
        .select('name');
      if (error) throw error;
      if (!data || !data.length) return { ok: false };
      return { ok: true, name: data[0].name };
    },
    // Append offline teachers (no Telegram account) to a class. Each gets a
    // synthetic telegram_user_id so it satisfies the NOT NULL / unique schema
    // without touching existing teachers (unlike saveTeachers, which replaces).
    addOfflineTeachers: async (groupId, entries) => {
      const gid = normalizeGroupId(groupId);
      const rows = (Array.isArray(entries) ? entries : [])
        .filter((e) => e && e.name && Array.isArray(e.types) && e.types.length)
        .map((e) => ({
          telegram_user_id: `offline:${randomUUID()}`,
          name: String(e.name).trim(),
          teacher_types: e.types.map((t) => String(t).trim()).filter(Boolean),
          active: true,
        }))
        .filter((r) => r.name && r.teacher_types.length);
      if (!rows.length) return { added: 0 };
      const groupRowId = await ensureGroupRowId(gid);
      const payload = rows.map((r) => ({ ...r, group_id: groupRowId }));
      const { error } = await db.from('teachers').insert(payload);
      if (error) throw error;
      return { added: payload.length };
    },
    // Rename an offline teacher, addressed by her row id (scoped to the class).
    renameOfflineTeacher: async (groupId, teacherId, newName) => {
      const gid = normalizeGroupId(groupId);
      const name = String(newName || '').trim();
      const tid = Number(teacherId);
      if (!name || !Number.isInteger(tid)) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('teachers')
        .update({ name })
        .eq('group_id', groupRowId)
        .eq('id', tid)
        .eq('active', true)
        .select('name');
      if (error) throw error;
      if (!data || !data.length) return { ok: false };
      return { ok: true, name };
    },
    // Set an offline teacher's role set (a non-empty array of role names).
    setOfflineTeacherTypes: async (groupId, teacherId, teacherTypes) => {
      const gid = normalizeGroupId(groupId);
      const types = (Array.isArray(teacherTypes) ? teacherTypes : [])
        .map((t) => String(t || '').trim())
        .filter(Boolean);
      const tid = Number(teacherId);
      if (!types.length || !Number.isInteger(tid)) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('teachers')
        .update({ teacher_types: types })
        .eq('group_id', groupRowId)
        .eq('id', tid)
        .eq('active', true)
        .select('name,teacher_types');
      if (error) throw error;
      if (!data || !data.length) return { ok: false };
      return { ok: true, name: data[0].name, types: data[0].teacher_types };
    },
    // Soft-delete an offline teacher (active=false) so past session assignments
    // stay intact. Addressed by row id. Returns { ok, name }.
    removeOfflineTeacher: async (groupId, teacherId) => {
      const gid = normalizeGroupId(groupId);
      const tid = Number(teacherId);
      if (!Number.isInteger(tid)) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('teachers')
        .update({ active: false })
        .eq('group_id', groupRowId)
        .eq('id', tid)
        .eq('active', true)
        .select('name');
      if (error) throw error;
      if (!data || !data.length) return { ok: false };
      return { ok: true, name: data[0].name };
    },
    // ── Offline training groups ──────────────────────────────────────────────
    // Offline classes have no linked Telegram group, so their "training groups"
    // are labels stored in group_settings.training_groups (shape { groupId, name }
    // where groupId is a synthetic id). Each offline student stores the id of the
    // single training group she belongs to in members.training_group_id.
    getOfflineTrainingGroups: async (groupId) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await findGroupRowId(gid);
      if (!groupRowId) return [];
      const { data, error } = await db
        .from('group_settings')
        .select('training_groups')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      const groups = Array.isArray(data?.training_groups) ? data.training_groups : [];
      return groups
        .filter((row) => row?.groupId && row?.name)
        .map((row) => ({ id: String(row.groupId), name: String(row.name) }));
    },
    addOfflineTrainingGroup: async (groupId, name) => {
      const gid = normalizeGroupId(groupId);
      const label = String(name || '').trim();
      if (!label) return { ok: false, reason: 'invalid' };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('group_settings')
        .select('training_groups')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      const groups = Array.isArray(data?.training_groups) ? data.training_groups.slice() : [];
      if (groups.some((row) => row?.name && String(row.name).trim() === label)) {
        return { ok: false, reason: 'duplicate' };
      }
      const id = randomUUID();
      groups.push({ groupId: id, name: label });
      const { error: upsertError } = await db
        .from('group_settings')
        .upsert({ group_id: groupRowId, training_groups: groups }, { onConflict: 'group_id' });
      if (upsertError) throw upsertError;
      return { ok: true, group: { id, name: label } };
    },
    renameOfflineTrainingGroup: async (groupId, trainingGroupId, name) => {
      const gid = normalizeGroupId(groupId);
      const label = String(name || '').trim();
      const tid = String(trainingGroupId || '');
      if (!label || !tid) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('group_settings')
        .select('training_groups')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      const groups = Array.isArray(data?.training_groups) ? data.training_groups.slice() : [];
      const entry = groups.find((row) => String(row?.groupId) === tid);
      if (!entry) return { ok: false };
      entry.name = label;
      const { error: upsertError } = await db
        .from('group_settings')
        .upsert({ group_id: groupRowId, training_groups: groups }, { onConflict: 'group_id' });
      if (upsertError) throw upsertError;
      return { ok: true, name: label };
    },
    removeOfflineTrainingGroup: async (groupId, trainingGroupId) => {
      const gid = normalizeGroupId(groupId);
      const tid = String(trainingGroupId || '');
      if (!tid) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const { data, error } = await db
        .from('group_settings')
        .select('training_groups')
        .eq('group_id', groupRowId)
        .maybeSingle();
      if (error) throw error;
      const groups = Array.isArray(data?.training_groups) ? data.training_groups.slice() : [];
      const idx = groups.findIndex((row) => String(row?.groupId) === tid);
      if (idx === -1) return { ok: false };
      const [removed] = groups.splice(idx, 1);
      const { error: upsertError } = await db
        .from('group_settings')
        .upsert({ group_id: groupRowId, training_groups: groups }, { onConflict: 'group_id' });
      if (upsertError) throw upsertError;
      // Unassign any students who were in this training group.
      const { error: clearError } = await db
        .from('members')
        .update({ training_group_id: null })
        .eq('group_id', groupRowId)
        .eq('training_group_id', tid);
      if (clearError) throw clearError;
      return { ok: true, name: String(removed?.name || '') };
    },
    // Assign an offline student (by list number) to a training group, or clear
    // it when trainingGroupId is null/empty.
    setOfflineStudentTrainingGroup: async (groupId, listNumber, trainingGroupId) => {
      const gid = normalizeGroupId(groupId);
      const ln = Number(listNumber);
      if (!Number.isInteger(ln)) return { ok: false };
      const groupRowId = await ensureGroupRowId(gid);
      const nextValue = trainingGroupId ? String(trainingGroupId) : null;
      const { data, error } = await db
        .from('members')
        .update({ training_group_id: nextValue })
        .eq('group_id', groupRowId)
        .eq('list_number', ln)
        .eq('active', true)
        .select('name');
      if (error) throw error;
      if (!data || !data.length) return { ok: false };
      return { ok: true, name: data[0].name };
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
        // Remove cross-group references where other groups list this group as a training target.
        const { data: settingsRows, error: settingsReadError } = await db
          .from('group_settings')
          .select('group_id,training_groups');
        if (settingsReadError) throw settingsReadError;

        for (const row of settingsRows || []) {
          const groups = Array.isArray(row?.training_groups) ? row.training_groups : [];
          const next = groups.filter((entry) => String(entry?.groupId || '') !== gid);
          if (next.length === groups.length) continue;

          const { error: updateSettingsError } = await db
            .from('group_settings')
            .update({ training_groups: next })
            .eq('group_id', row.group_id);
          if (updateSettingsError) throw updateSettingsError;
        }

        const groupRowId = await findGroupRowId(gid);
        if (groupRowId) {
          const { error } = await db
            .from('groups')
            .delete()
            .eq('id', groupRowId);
          if (error) throw error;
        }
      } catch (e) {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'v2_clear_group_data_failed_fallback_kv_cleanup',
          message: e?.message || String(e),
          groupId: gid,
          at: new Date().toISOString(),
        }));
      }

    },
  };
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const backend = await supabaseBackend();
console.log('🗄️  Storage: Supabase');

export default backend;
