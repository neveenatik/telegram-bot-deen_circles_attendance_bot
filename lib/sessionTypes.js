export const ACTIVE_SESSION_TYPES = [
  'main',
  'training',
  'open',
  'registeredSecondary',
  'personalRecitation',
  'groupRecitation',
];

// Session types that require admin-authorized registration. This single
// property defines the "roster-attendance" family (main, training,
// registeredSecondary) and drives several behaviors:
//   - Walk-ins: a non-roster user who taps a status is queued as a pending
//     registration (and still counted present live) rather than added to the
//     roster on the spot — an accidental tap must not pollute the members list.
//     Approval adds them to the group's own roster (and, for training lists,
//     backfills them into the linked main group).
//   - Excused button: shown on these lists (excused only makes sense for a
//     known roster).
//   - Absent reporting: the attendance report lists absentees, since a rostered
//     member who never responds is genuinely absent.
//
// The remaining types (open, personalRecitation, groupRecitation) are transient
// walk-in lists that do not persist membership, add walk-ins to the roster
// directly, hide the excused button, and never report absentees.
export const APPROVAL_REGISTRATION_TYPES = ['main', 'training', 'registeredSecondary'];

// A known, first-class session type (as opposed to a legacy/`other` bucket type
// that no longer maps to one of the canonical kinds).
export function isActiveSessionType(type) {
  return ACTIVE_SESSION_TYPES.includes(type);
}

export function requiresRegistrationApproval(type) {
  return APPROVAL_REGISTRATION_TYPES.includes(type);
}

// The call status marks a member as being called on to recite
// (responding / responded / away) and is shown as an icon in the live list and
// manage panel. It is relevant to every session type EXCEPT `main`, whose plain
// attendance roll has no recitation calling.
export function usesCallStatus(type) {
  return type !== 'main';
}

export async function getActiveSessionType(getSession, groupId) {
  for (const type of ACTIVE_SESSION_TYPES) {
    const session = await getSession(groupId, type);
    if (session?.active) return type;
  }
  return null;
}
