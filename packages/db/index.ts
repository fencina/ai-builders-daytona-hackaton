import * as sqlite from './sqlite.ts';
import { rpc } from './supabase.ts';

export { projectRoot, databasePath, hash } from './sqlite.ts';
export type { Shift, Employee, Application } from './sqlite.ts';
export type Snapshot = ReturnType<typeof sqlite.snapshot>;
export type InvitationStatus = 'sending' | 'sent' | 'uncertain';

export const usesSupabase = () => process.env.SHIFTS_STORAGE === 'supabase';
export const id = () => sqlite.id();
export const now = () => sqlite.now();

export async function snapshot(): Promise<Snapshot> {
  return usesSupabase() ? rpc<Snapshot>('snapshot', {}) : sqlite.snapshot();
}

export async function setting(key: string): Promise<string> {
  // The service credential is a deployment secret, not business data.
  if (key === 'internal_token' && usesSupabase()) {
    const token = process.env.SHIFTS_INTERNAL_TOKEN;
    if (!token) throw new Error('Falta SHIFTS_INTERNAL_TOKEN en el servidor.');
    return token;
  }
  return usesSupabase() ? rpc<string>('setting', { key }) : sqlite.setting(key);
}

export async function event(message: string): Promise<void> {
  if (usesSupabase()) await rpc('event', { message });
  else sqlite.event(message);
}

export async function createStore(value: { name: string; address: string }, actor: string): Promise<string> {
  const storeId = sqlite.id();
  if (usesSupabase()) {
    await rpc('store', { ...value, id: storeId, actor });
    return storeId;
  }
  sqlite.transaction(() => {
    sqlite.db().prepare('INSERT INTO shifts_stores VALUES (?,?,?)').run(storeId, value.name, value.address);
    sqlite.event(`${actor} creó la tienda ${value.name}.`);
  });
  return storeId;
}

export async function createEmployee(value: { name: string; phone: string; storeIds: string[] }, actor: string): Promise<string> {
  const employeeId = sqlite.id();
  if (usesSupabase()) {
    await rpc('employee', { ...value, id: employeeId, actor });
    return employeeId;
  }
  sqlite.transaction(() => {
    sqlite.db().prepare('INSERT INTO shifts_employees VALUES (?,?,?,1)').run(employeeId, value.name, value.phone);
    for (const storeId of new Set(value.storeIds)) sqlite.db().prepare('INSERT INTO shifts_employee_stores VALUES (?,?)').run(employeeId, storeId);
    sqlite.event(`${actor} registró a ${value.name}.`);
  });
  return employeeId;
}

export async function createShift(value: { storeId: string; role: string; startsAt: string; endsAt: string; capacity: number }, actor: string): Promise<string> {
  const shiftId = sqlite.id();
  if (usesSupabase()) {
    await rpc('shift', { ...value, id: shiftId, actor });
    return shiftId;
  }
  sqlite.transaction(() => {
    sqlite.db().prepare('INSERT INTO shifts_turns VALUES (?,?,?,?,?,?,?,?)').run(shiftId, value.storeId, value.role, value.startsAt, value.endsAt, value.capacity, 'open', sqlite.now());
    sqlite.event(`${actor} creó un turno de ${value.role}.`);
  });
  return shiftId;
}

export async function saveSettings(adminPhone: string, session: string): Promise<void> {
  if (usesSupabase()) {
    await rpc('settings', { adminPhone, session });
    return;
  }
  sqlite.transaction(() => {
    sqlite.setSetting('admin_phone', adminPhone);
    sqlite.setSetting('openwa_session', session);
  });
}

export async function candidates(shiftId: string): Promise<sqlite.Employee[]> {
  return usesSupabase() ? rpc<sqlite.Employee[]>('candidates', { shiftId }) : sqlite.candidates(shiftId);
}

export async function outstandingInvitations(shiftId: string): Promise<number> {
  if (usesSupabase()) return rpc<number>('outstanding', { shiftId });
  return (sqlite.db().prepare("SELECT count(*) n FROM shifts_invitations WHERE shift_id=? AND status IN ('sent','sending','uncertain')").get(shiftId) as { n: number }).n;
}

/**
 * Atomically reserves one invitation slot before any network I/O.
 * Returns null when the shift is already fully covered or the employee was contacted.
 */
export async function claimInvitation(shiftId: string, employeeId: string): Promise<string | null> {
  const invitationId = sqlite.id();
  if (usesSupabase()) return rpc<string | null>('claim', { id: invitationId, shiftId, employeeId });
  return sqlite.transaction(() => {
    const shift = sqlite.snapshot().shifts.find((s) => s.id === shiftId);
    if (!shift) return null;
    const pending = (sqlite.db().prepare("SELECT count(*) n FROM shifts_invitations WHERE shift_id=? AND status IN ('sent','sending','uncertain')").get(shiftId) as { n: number }).n;
    if (shift.assigned + shift.pending + pending >= shift.capacity) return null;
    const result = sqlite.db()
      .prepare(`INSERT INTO shifts_invitations VALUES (?,?,?,?,?) ON CONFLICT(shift_id,employee_id)
        DO UPDATE SET status='sending',id=excluded.id WHERE status='failed'`)
      .run(invitationId, shiftId, employeeId, 'sending', sqlite.now());
    return result.changes ? invitationId : null;
  });
}

export async function markInvitation(invitationId: string, from: InvitationStatus | 'sent', to: InvitationStatus | 'declined'): Promise<boolean> {
  if (usesSupabase()) return rpc<boolean>('invitation_status', { invitationId, from, to });
  return !!sqlite.db().prepare('UPDATE shifts_invitations SET status=? WHERE id=? AND status=?').run(to, invitationId, from).changes;
}

export async function apply(invitationId: string): Promise<string> {
  return usesSupabase() ? rpc<string>('apply', { invitationId }) : sqlite.apply(invitationId);
}

export async function decide(applicationId: string, decision: 'approved' | 'rejected', actor: string): Promise<{ ok: boolean; changed: boolean }> {
  return usesSupabase() ? rpc('decide', { applicationId, decision, actor }) : sqlite.decide(applicationId, decision, actor);
}

/** Idempotency gate for inbound webhooks. Returns false when the key was already processed. */
export async function claimWebhook(key: string): Promise<boolean> {
  if (usesSupabase()) return rpc<boolean>('claim_webhook', { key });
  return !!sqlite.db().prepare('INSERT OR IGNORE INTO shifts_webhook_events VALUES (?,?)').run(key, sqlite.now()).changes;
}

export async function employeeByPhone(phone: string): Promise<{ id: string } | null> {
  if (usesSupabase()) return rpc<{ id: string } | null>('employee_phone', { phone });
  return (sqlite.db().prepare('SELECT id FROM shifts_employees WHERE phone=? AND active=1').get(phone) as { id: string } | undefined) || null;
}

export async function invitationBelongsTo(invitationId: string, employeeId: string): Promise<boolean> {
  if (usesSupabase()) return rpc<boolean>('invitation_for', { invitationId, employeeId });
  return !!sqlite.db().prepare("SELECT 1 FROM shifts_invitations WHERE id=? AND employee_id=? AND status='sent'").get(invitationId, employeeId);
}
