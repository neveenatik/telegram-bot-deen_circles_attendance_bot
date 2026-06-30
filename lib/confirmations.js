// Confirmation token management

const pendingConfirms = new Map();
const CONFIRM_TTL_MS = 10 * 60 * 1000;

const newConfirmToken = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export function setPendingConfirm(userId, payload) {
  const token = newConfirmToken();
  pendingConfirms.set(token, {
    token,
    userId: String(userId),
    expiresAt: Date.now() + CONFIRM_TTL_MS,
    ...payload,
  });
  return token;
}

export function getPendingConfirm(token) {
  return pendingConfirms.get(token);
}

export function deletePendingConfirm(token) {
  pendingConfirms.delete(token);
}
