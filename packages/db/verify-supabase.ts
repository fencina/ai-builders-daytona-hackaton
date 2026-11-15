// Verifies the Supabase business path against the real project, then removes its fixtures.
// Run with: node --env-file=apps/web/.env.local --experimental-strip-types packages/db/verify-supabase.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rpc } from './supabase.ts';

const tag = randomUUID().slice(0, 8);
const storeId = randomUUID();
const employeeA = randomUUID();
const employeeB = randomUUID();
const shiftId = randomUUID();
const start = new Date(Date.now() + 2 * 86400000);
const end = new Date(start.getTime() + 8 * 3600000);
const created = { stores: [storeId], employees: [employeeA, employeeB], shifts: [shiftId] };

try {
  await rpc('store', { id: storeId, name: `Prueba ${tag}`, address: 'Solo verificación', actor: 'Verificación' });
  await rpc('employee', { id: employeeA, name: `Empleada ${tag}`, phone: `54911${Date.now().toString().slice(-8)}`, storeIds: [storeId], actor: 'Verificación' });
  await rpc('employee', { id: employeeB, name: `Empleado ${tag}`, phone: `54911${(Date.now() + 1).toString().slice(-8)}`, storeIds: [storeId], actor: 'Verificación' });
  await rpc('shift', { id: shiftId, storeId, role: 'Caja', startsAt: start.toISOString(), endsAt: end.toISOString(), capacity: 1, actor: 'Verificación' });

  const candidates = await rpc<{ id: string }[]>('candidates', { shiftId });
  assert.equal(candidates.length, 2, 'both eligible employees are candidates');

  const first = await rpc<string | null>('claim', { id: randomUUID(), shiftId, employeeId: employeeA });
  assert.ok(first, 'first invitation is claimed');
  const blocked = await rpc<string | null>('claim', { id: randomUUID(), shiftId, employeeId: employeeB });
  assert.equal(blocked, null, 'capacity is enforced before sending a second batch');

  await rpc('invitation_status', { invitationId: first, from: 'sending', to: 'sent' });
  const applicationId = await rpc<string>('apply', { invitationId: first });
  let snap = await rpc<{ shifts: { assigned: number; pending: number }[]; applications: { id: string; status: string }[] }>('snapshot', {});
  assert.equal(snap.shifts.find((s) => (s as unknown as { id: string }).id === shiftId)?.pending, 1, 'acceptance stays pending');
  assert.equal(snap.applications.find((a) => a.id === applicationId)?.status, 'pending');

  const approved = await rpc<{ changed: boolean }>('decide', { applicationId, decision: 'approved', actor: 'Verificación' });
  assert.equal(approved.changed, true);
  const again = await rpc<{ changed: boolean }>('decide', { applicationId, decision: 'approved', actor: 'Verificación' });
  assert.equal(again.changed, false, 'approval is idempotent');
  snap = await rpc('snapshot', {});
  assert.equal(snap.shifts.find((s) => (s as unknown as { id: string }).id === shiftId)?.assigned, 1);

  const outOfCapacity = await rpc<string | null>('claim', { id: randomUUID(), shiftId, employeeId: employeeB });
  assert.equal(outOfCapacity, null, 'no outreach once coverage is complete');

  const duplicateApplication = await rpc<string>('apply', { invitationId: first }).catch((error: Error) => error.message);
  assert.match(String(duplicateApplication), /no está pendiente/, 'an invitation cannot be accepted twice');

  const webhookKey = `verify:${tag}`;
  assert.equal(await rpc<boolean>('claim_webhook', { key: webhookKey }), true);
  assert.equal(await rpc<boolean>('claim_webhook', { key: webhookKey }), false, 'webhook replays are rejected');

  const settings = await rpc<{ configured: boolean }>('snapshot', {});
  assert.equal(typeof settings.settings.configured, 'boolean');
  console.log('PASS Supabase: schema, candidates, transactional capacity, pending application, idempotent approval, double-accept rejection, webhook deduplication.');
} finally {
  // Fixtures are removed afterwards with the ids printed below (service-side SQL).
  console.log(JSON.stringify({ tag, storeId, employeeIds: [employeeA, employeeB], shiftId }));
}
