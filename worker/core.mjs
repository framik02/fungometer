export const DAY = 86400000;
export const TERMS_VERSION = '2026-10-06';
export const PLANS = Object.freeze({
  season: { name: 'Pass 90 giorni', amount: 990, days: 90 },
  year: { name: 'Pass 12 mesi', amount: 1990, days: 365 }
});
export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Inserisci un indirizzo email valido.');
  return email;
}
export const isLocal = (request, env) => env.APP_ENV === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
export function entitlement(user, paidUntil, now = Date.now()) {
  if (paidUntil > now) return { active: true, kind: 'paid', until: paidUntil };
  if (user?.trial_ends_at > now) return { active: true, kind: 'trial', until: user.trial_ends_at };
  return { active: false, kind: user?.trial_started_at ? 'expired' : 'locked', until: null };
}
export async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0;
}
export async function verifyStripeSignature(body, header, secret, now=Date.now()) {
  if (!secret || !header) return false;
  const pieces = header.split(',').map(x=>x.split('='));
  const timestamp = pieces.find(([k])=>k==='t')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(now/1000-Number(timestamp))>300) return false;
  const expected=await hmac(secret,`${timestamp}.${body}`);
  return pieces.some(([k,v])=>k==='v1' && equal(v,expected));
}
export function validatePaidSession(session, order) {
  return Boolean(order && session.mode==='payment' && session.payment_status==='paid'
    && session.id===order.session_id && session.client_reference_id===order.user_id
    && session.metadata?.order_id===order.id && session.currency==='eur'
    && session.amount_total===order.amount && session.livemode===(order.mode==='live')
    && typeof session.payment_intent==='string');
}
