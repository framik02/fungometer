import {normalizeEmail} from './core.mjs';

export function isOwner(user, env) {
  try { return Boolean(user) && normalizeEmail(user.email) === normalizeEmail(env.SUPPORT_EMAIL); }
  catch { return false; }
}

export async function launchProgress(env) {
  // Count people, not sessions or repeat purchases. Test orders, abandoned
  // checkouts, refunded orders and disputed payments cannot reach the target.
  const row = await env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS customers
    FROM orders WHERE mode='live' AND paid_at IS NOT NULL AND revoked=0 AND amount>0`).first();
  const payingCustomers = Number(row?.customers || 0);
  return {payingCustomers, target: 5, remaining: Math.max(0, 5-payingCustomers),
    targetReached: payingCustomers >= 5};
}
