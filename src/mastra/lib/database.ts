import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';

mkdirSync(resolve('.data'), { recursive: true });
export const db = createClient({
  url: process.env.SHIFTS_DATABASE_URL || `file:${resolve('.data/shifts.db')}`,
  authToken: process.env.SHIFTS_DATABASE_AUTH_TOKEN,
});
let initialization: Promise<unknown> | undefined;
export function initializeDatabase() {
  return initialization ??= db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS employees (id TEXT PRIMARY KEY, phone_number TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available', employee_id TEXT REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS outreach (
      shift_id TEXT NOT NULL, employee_id TEXT NOT NULL, sent_at TEXT NOT NULL,
      PRIMARY KEY (shift_id, employee_id)
    );
    CREATE TABLE IF NOT EXISTS shift_conversations (
      employee_id TEXT PRIMARY KEY, offer_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
}
export type Employee = { id: string; phone_number: string; name: string };
export type Shift = { id: string; start_at: string; end_at: string; status: string; employee_id: string | null };
export const businessTimezone = process.env.BUSINESS_TIMEZONE || 'Asia/Tokyo';
function dateInTimezone(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: businessTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export async function findUrgentShifts() {
  await initializeDatabase();
  const nextDay = new Date(`${dateInTimezone(new Date())}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const tomorrow = nextDay.toISOString().slice(0, 10);
  const result = await db.execute("SELECT * FROM shifts WHERE status = 'available' AND employee_id IS NULL ORDER BY start_at");
  const shifts = (result.rows as unknown as Shift[]).filter(s => dateInTimezone(new Date(s.start_at)) === tomorrow);
  return { date: tomorrow, timezone: businessTimezone, shifts };
}
export async function getEmployees() {
  await initializeDatabase();
  return (await db.execute('SELECT * FROM employees')).rows as unknown as Employee[];
}
export async function getConversation(employeeId: string) {
  await initializeDatabase();
  return (await db.execute({ sql: 'SELECT * FROM shift_conversations WHERE employee_id = ?', args: [employeeId] })).rows[0];
}
export async function setConversation(employeeId: string, date: string, status: 'active' | 'assigned' | 'declined') {
  await initializeDatabase();
  await db.execute({
    sql: `INSERT INTO shift_conversations (employee_id, offer_date, status) VALUES (?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET offer_date = excluded.offer_date, status = excluded.status`,
    args: [employeeId, date, status],
  });
}
export async function assignShift(shiftId: string, employeeId: string) {
  await initializeDatabase();
  const result = await db.execute({
    sql: `UPDATE shifts SET employee_id = ?, status = 'not available'
      WHERE id = ? AND status = 'available' AND employee_id IS NULL
      AND EXISTS (SELECT 1 FROM employees WHERE id = ?)`,
    args: [employeeId, shiftId, employeeId],
  });
  return { assigned: result.rowsAffected === 1, shift_id: shiftId, employee_id: employeeId };
}
