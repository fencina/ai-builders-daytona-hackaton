import { db, findUrgentShifts, getEmployees, setConversation } from './database';

export function normalizePhone(value: string) {
  const digits = value.split('@')[0].replace(/\D/g, '');
  // Argentine mobile WhatsApp IDs include a 9 after country code 54.
  return /^549\d{10}$/.test(digits) ? `54${digits.slice(3)}` : digits;
}

export async function resolveSenderPhone(from: string, senderPhone?: string | null) {
  if (senderPhone) return normalizePhone(senderPhone);
  if (!from.endsWith('@lid')) return normalizePhone(from);
  const baseUrl = process.env.OPENWA_API_URL;
  const session = process.env.OPENWA_SESSION_ID;
  if (!baseUrl || !session) throw new Error('OpenWA is not configured for sender lookup');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(session)}/contacts/${encodeURIComponent(from)}/phone`, {
    headers: process.env.OPENWA_API_KEY ? { 'x-api-key': process.env.OPENWA_API_KEY } : {},
  });
  if (!response.ok) throw new Error(`OpenWA sender lookup failed (${response.status})`);
  const result = await response.json() as { phone: string | null };
  return result.phone ? normalizePhone(result.phone) : null;
}

export async function sendWhatsAppMessage(employeeId: string, message: string, shiftIds: string[] = []) {
  const employee = (await getEmployees()).find(e => e.id === employeeId);
  if (!employee) throw new Error('Employee not found');
  const baseUrl = process.env.OPENWA_API_URL;
  const session = process.env.OPENWA_SESSION_ID;
  if (!baseUrl || !session) throw new Error('Set OPENWA_API_URL and OPENWA_SESSION_ID to send WhatsApp messages');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(session)}/messages/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.OPENWA_API_KEY ? { 'x-api-key': process.env.OPENWA_API_KEY } : {}) },
    body: JSON.stringify({ chatId: `${employee.phone_number.replace(/\D/g, '')}@c.us`, text: message }),
  });
  if (!response.ok) throw new Error(`OpenWA send failed (${response.status}): ${await response.text()}`);
  for (const shiftId of shiftIds) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO outreach (shift_id, employee_id, sent_at) VALUES (?, ?, ?)', args: [shiftId, employeeId, new Date().toISOString()] });
  }
  if (shiftIds.length) await setConversation(employeeId, (await findUrgentShifts()).date, 'active');
  return { sent: true, employee_id: employeeId };
}
