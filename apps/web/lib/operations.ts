import 'server-only';
import { z } from 'zod';
import { db,id,now,event,transaction,setSetting,snapshot,decide,setting,candidates,apply } from '../../../packages/db';
import { sendWhatsApp } from './whatsapp';

const phone=z.string().regex(/^\+?[1-9]\d{7,14}$/,'Usa un teléfono internacional, por ejemplo +5491123456789.');
const storeSchema=z.object({name:z.string().trim().min(2).max(100),address:z.string().trim().max(200).default('')});
const employeeSchema=z.object({name:z.string().trim().min(2).max(100),phone,storeIds:z.array(z.string().uuid()).min(1)});
const shiftSchema=z.object({storeId:z.string().uuid(),role:z.string().trim().min(2).max(100),startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),capacity:z.number().int().min(1).max(100)});

export async function operation(action:string,input:unknown,actor:string) {
  if (action==='store') {
    const value=storeSchema.parse(input);
    db().prepare('INSERT INTO shifts_stores VALUES (?,?,?)').run(id(),value.name,value.address);
    event(`${actor} creó la tienda ${value.name}.`);
  } else if (action==='employee') {
    const value=employeeSchema.parse(input);
    transaction(()=> {
      const employeeId=id();
      db().prepare('INSERT INTO shifts_employees VALUES (?,?,?,1)').run(employeeId,value.name,value.phone.replace(/^\+/,''));
      for(const storeId of new Set(value.storeIds)) db().prepare('INSERT INTO shifts_employee_stores VALUES (?,?)').run(employeeId,storeId);
      event(`${actor} registró a ${value.name}.`);
    });
  } else if (action==='shift') {
    const value=shiftSchema.parse(input);
    if (value.endsAt<=value.startsAt || Date.parse(value.startsAt)<=Date.now() || Date.parse(value.endsAt)-Date.parse(value.startsAt)>86400000) throw new Error('El turno debe ser futuro, terminar después del inicio y durar hasta 24 horas.');
    const shiftId=id();
    db().prepare('INSERT INTO shifts_turns VALUES (?,?,?,?,?,?,?,?)').run(shiftId,value.storeId,value.role,value.startsAt,value.endsAt,value.capacity,'open',now());
    event(`${actor} creó un turno de ${value.role}.`);
    if(setting('admin_phone')&&setting('openwa_session')) {
      try {await search(shiftId);} catch {event('El turno fue creado. No se pudo iniciar la búsqueda automática; revisa la conexión y busca cobertura desde el detalle.');}
    }
  } else if (action==='settings') {
    const value=z.object({adminPhone:phone,session:z.string().trim().min(1).max(100)}).parse(input);
    setSetting('admin_phone',value.adminPhone.replace(/^\+/,''));setSetting('openwa_session',value.session);
  } else if (action==='decision') {
    const value=z.object({applicationId:z.string().uuid(),decision:z.enum(['approved','rejected'])}).parse(input);
    const result=decide(value.applicationId,value.decision,actor);
    if (result.changed) {
      const application=snapshot().applications.find(a=>a.id===value.applicationId)!;
      try { await sendWhatsApp(application.phone,`Tu postulación para ${application.store_name}, ${formatDate(application.starts_at)} fue ${value.decision==='approved'?'aprobada. ¡Te esperamos!':'rechazada. Gracias por responder.'}`); }
      catch { event('La decisión fue guardada, pero falló el aviso de WhatsApp al empleado.'); }
    }
  } else if (action==='search') {
    const {shiftId}=z.object({shiftId:z.string().uuid()}).parse(input);
    return search(shiftId);
  } else throw new Error('Acción no admitida.');
  return {ok:true};
}
export function formatDate(value:string) {
  return new Date(value).toLocaleString('es-AR',{timeZone:process.env.SHIFTS_TIMEZONE||'America/Argentina/Buenos_Aires',dateStyle:'medium',timeStyle:'short'});
}
export async function search(shiftId:string) {
  if (!setting('admin_phone') || !setting('openwa_session')) throw new Error('Configura el número del administrador y la sesión de WhatsApp.');
  const shift=snapshot().shifts.find(t=>t.id===shiftId);
  if (!shift || shift.status!=='open') throw new Error('Turno no disponible.');
  const outstanding=(db().prepare("SELECT count(*) n FROM shifts_invitations WHERE shift_id=? AND status IN ('sent','sending','uncertain')").get(shiftId) as {n:number}).n;
  const free=shift.capacity-shift.assigned-shift.pending-outstanding;
  if(free<=0) throw new Error('Ya hay suficientes asignaciones, postulantes o invitaciones pendientes de respuesta.');
  let sent=0;
  // A small batch, with a unique claim before network I/O: concurrent searches cannot send duplicates.
  for(const employee of candidates(shiftId).slice(0,Math.min(free,3))) {
    const invitationId=id();
    const claimed=db().prepare(`INSERT INTO shifts_invitations VALUES (?,?,?,?,?) ON CONFLICT(shift_id,employee_id)
      DO UPDATE SET status='sending',id=excluded.id WHERE status='failed'`).run(invitationId,shiftId,employee.id,'sending',now());
    if(!claimed.changes) continue;
    try {
      await sendWhatsApp(employee.phone,`Hola ${employee.name}, ¿puedes cubrir el turno de ${shift.role} en ${shift.store_name}?\nDesde: ${formatDate(shift.starts_at)}\nHasta: ${formatDate(shift.ends_at)}\nResponde SI ${invitationId} o NO ${invitationId}. Tu aceptación requiere aprobación del administrador.`);
      db().prepare("UPDATE shifts_invitations SET status='sent' WHERE id=?").run(invitationId);sent++;
    } catch {
      // Delivery can be uncertain after timeout: don't auto-retry and risk duplicate messages.
      db().prepare("UPDATE shifts_invitations SET status='uncertain' WHERE id=?").run(invitationId);
      event(`No se pudo confirmar la entrega de una invitación a ${employee.name}. Revisar OpenWA antes de reintentar.`);
    }
  }
  event(`Búsqueda de cobertura: ${sent} invitaciones enviadas para ${shift.store_name}.`);
  return {ok:true,sent,message:sent?`${sent} invitaciones enviadas.`:'No se enviaron invitaciones. Revisa candidatos habilitados y actividad.'};
}
export async function acceptInvitation(invitationId:string) {
  const applicationId=apply(invitationId);
  const application=snapshot().applications.find(a=>a.id===applicationId)!;
  try {
    await sendWhatsApp(setting('admin_phone'),`Encontré un postulante: ${application.name}\n${application.store_name} · ${application.role}\n${formatDate(application.starts_at)}\nResponde APROBAR ${applicationId} o RECHAZAR ${applicationId}, o revisa la interfaz web.`);
  } catch {event('Postulación guardada. Falló el aviso de WhatsApp al administrador; revisa Pendientes.');}
  return applicationId;
}
