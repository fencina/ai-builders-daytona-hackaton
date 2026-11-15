import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const folder=mkdtempSync(path.join(tmpdir(),'turno-test-'));
process.env.SHIFTS_DATABASE_PATH=path.join(folder,'test.db');
const {db,id,now,snapshot,apply,decide,candidates}=await import('./index.ts');
after(()=>{db().close();rmSync(folder,{recursive:true,force:true});});
const storeId=id();
db().prepare('INSERT INTO shifts_stores VALUES (?,?,?)').run(storeId,'Tienda de prueba','');
function employee(){const eid=id();db().prepare('INSERT INTO shifts_employees VALUES (?,?,?,1)').run(eid,'Empleado de prueba',`549${Date.now()}${Math.floor(Math.random()*10000)}`);db().prepare('INSERT INTO shifts_employee_stores VALUES (?,?)').run(eid,storeId);return eid;}
function shift(capacity=1,offset=0){const sid=id();db().prepare('INSERT INTO shifts_turns VALUES (?,?,?,?,?,?,?,?)').run(sid,storeId,'Caja',new Date(Date.now()+86400000+offset).toISOString(),new Date(Date.now()+115200000+offset).toISOString(),capacity,'open',now());return sid;}
function invite(sid:string,eid:string){const iid=id();db().prepare('INSERT INTO shifts_invitations VALUES (?,?,?,?,?)').run(iid,sid,eid,'sent',now());return iid;}

test('la aceptación crea una postulación, no una asignación',()=>{const sid=shift();const aid=apply(invite(sid,employee()));assert.equal(snapshot().applications.find(a=>a.id===aid)?.status,'pending');assert.equal(snapshot().shifts.find(s=>s.id===sid)?.assigned,0);});
test('aprobar asigna una sola vez y es idempotente',()=>{const sid=shift();const aid=apply(invite(sid,employee()));assert.equal(decide(aid,'approved','test').changed,true);assert.equal(decide(aid,'approved','test').changed,false);assert.equal(snapshot().shifts.find(s=>s.id===sid)?.assigned,1);});
test('no se supera el cupo y se conserva la otra postulación',()=>{const sid=shift();const a=apply(invite(sid,employee()));const b=apply(invite(sid,employee()));decide(a,'approved','test');assert.throws(()=>decide(b,'approved','test'),/plazas/);assert.equal(snapshot().applications.find(p=>p.id===b)?.status,'pending');});
test('no se permiten turnos solapados',()=>{const eid=employee();const a=apply(invite(shift(),eid));const b=apply(invite(shift(),eid));decide(a,'approved','test');assert.throws(()=>decide(b,'approved','test'),/solapado/);});
test('rechazar no asigna y no se puede aprobar después',()=>{const aid=apply(invite(shift(),employee()));decide(aid,'rejected','test');assert.throws(()=>decide(aid,'approved','test'),/resuelta/);});
test('una invitación no se acepta dos veces',()=>{const iid=invite(shift(),employee());apply(iid);assert.throws(()=>apply(iid),/pendiente/);});
test('candidatos excluye a empleados ya contactados',()=>{const sid=shift();const eid=employee();assert.ok(candidates(sid).some(e=>e.id===eid));invite(sid,eid);assert.ok(!candidates(sid).some(e=>e.id===eid));});
test('no se aceptan empleados desactivados',()=>{const eid=employee();const iid=invite(shift(),eid);db().prepare('UPDATE shifts_employees SET active=0 WHERE id=?').run(eid);assert.throws(()=>apply(iid),/habilitado/);});
