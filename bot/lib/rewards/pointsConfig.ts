// Points config for the حسنات (motivation) system — phase 1 foundation (issue #14).
//
// Single, data-derived source of truth for how many points each tracked action
// is worth. Everything here is read-only config plus pure lookup helpers; the
// scoring module (issue #15) consumes it to aggregate per-member totals from the
// tables the bot already writes — no schema change and no extra student input:
//   • homework    → homework_submissions (submission only; reviewed/resubmitted
//                    are teacher-followup states, not student rewards)
//   • attendance  → session_participants.attendance_status × sessions.session_type
//                    (recitation is rewarded here, by attending; the pages
//                    recited are a progress/tracking detail, not a reward)
//
// The main circle is the core commitment, so its attendance is weighted highest,
// then training; the recitation-type lists (تصحيح التلاوة, personal/group
// recitation, and the generic open list) share the baseline weight.
import { SESSION_TYPES } from '../sessionTypes.js';

export type SessionType = (typeof SESSION_TYPES)[number];
export type AttendanceStatus = 'present' | 'listening' | 'excused' | 'absent';

export interface PointsConfig {
  // Points earned when a member submits a homework item. Only submission is
  // rewarded; review/resubmission are teacher-followup states.
  homeworkSubmitted: number;
  // Base points per final attendance status, before the session-type weight.
  attendance: Record<AttendanceStatus, number>;
  // Multiplier applied to attendance points by session type (main highest, then
  // training, then the recitation-family lists at baseline).
  sessionTypeWeight: Record<SessionType, number>;
}

export const DEFAULT_POINTS: PointsConfig = {
  homeworkSubmitted: 10,
  attendance: {
    present: 10,
    listening: 6,
    excused: 2,
    absent: 0,
  },
  sessionTypeWeight: {
    main: 1.5,
    training: 1.2,
    open: 1,
    registeredSecondary: 1,
    personalRecitation: 1,
    groupRecitation: 1,
  },
};

// Weighted points for one participant's attendance in a session. An unknown or
// null status (e.g. a walk-in row never resolved) earns nothing.
export function pointsForAttendance(
  status: AttendanceStatus | null | undefined,
  sessionType: SessionType,
  config: PointsConfig = DEFAULT_POINTS,
): number {
  if (!status) return 0;
  const base = config.attendance[status] ?? 0;
  const weight = config.sessionTypeWeight[sessionType] ?? 1;
  return base * weight;
}
