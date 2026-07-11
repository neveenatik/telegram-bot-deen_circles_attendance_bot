export const ACTIVE_SESSION_TYPES = [
  'main',
  'training',
  'open',
  'registeredSecondary',
  'personalRecitation',
  'groupRecitation',
];

export async function getActiveSessionType(getSession, groupId) {
  for (const type of ACTIVE_SESSION_TYPES) {
    const session = await getSession(groupId, type);
    if (session?.active) return type;
  }
  return null;
}
