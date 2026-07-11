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

    const [{ data: members, error: membersError }, { data: participantRows, error: participantsError }] = await Promise.all([
      db.from('members').select('id, telegram_user_id, name').eq('group_id', groupRowId).eq('active', true)
        .order('created_at', { ascending: true }),
      db.from('session_participants')
        .select('session_id, member_id, guest_name, display_name, attendance_status, called_state, registration_time, pages, verse')
        .in('session_id', sessionIds)
        .order('id', { ascending: true }),
    ]);
    if (membersError) throw membersError;
    if (participantsError) throw participantsError;

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
        if (p?.pages) rec.page = p.pages;
        if (p?.verse) rec.verse = p.verse;
        if (p?.registration_time) rec.registeredAt = new Date(p.registration_time).getTime();
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
      });
    }

    // Snapshot existing rows before delete so we can restore on insert failure
    const { data: existing, error: snapshotError } = await db
      .from('session_participants')
      .select('session_id, member_id, guest_name, display_name, attendance_status, called_state, registration_time, pages, verse')
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

  const upsertSessionRow = async (gid, type, session, archived = false) => {
    const groupRowId = await ensureGroupRowId(gid);
    // Strip participant data (stored in session_participants) and the group
    // recitation allocator (its own column, written only by the atomic RPC /
    // setGroupRecitationPageCounter) so a full save never clobbers either.
    const { participants, groupRecitationStartPage, ...blobData } =
      session && typeof session === 'object' ? session : {};
    const metadata = {
      session_blob: blobData,
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
    archiveSession: async (groupId, type, s) => {
      const gid = normalizeGroupId(groupId);
      const groupRowId = await ensureGroupRowId(gid);
      const sessionId = await upsertSessionRow(gid, type, { ...s, active: false }, true);
      await upsertSessionParticipants(sessionId, groupRowId, s);
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
        .select('id,session_type,name,series_id,active,chat_id,widget_message_id,group_recitation_next_page,started_at,ended_at,archived,metadata')
        .eq('group_id', groupRowId)
        .eq('archived', true)
        .order('started_at', { ascending: true });
      if (error) throw error;

      const rows = data || [];
      const participantsMap = await loadParticipantsForSessions(rows.map((r) => r.id), groupRowId);
      return rows.map((row) => toLegacySessionBlob(row, participantsMap[row.id] || null));
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
