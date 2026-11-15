import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

function findRoot() {
  let dir = process.cwd();
  while (true) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === 'ai-builders-daytona-hackaton') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('No se encontró la raíz del proyecto.');
    dir = parent;
  }
}

export const projectRoot = findRoot();
export const databasePath = process.env.SHIFTS_DATABASE_PATH
  ? path.resolve(projectRoot, process.env.SHIFTS_DATABASE_PATH)
  : path.join(projectRoot, 'src/mastra/public/.data/mastra.db');
let connection: DatabaseSync | undefined;

export function db() {
  if (connection) return connection;
  mkdirSync(path.dirname(databasePath), { recursive: true });
  connection = new DatabaseSync(databasePath);
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS shifts_users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES shifts_users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts_login_attempts (username TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts_stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS shifts_employees (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS shifts_employee_stores (employee_id TEXT REFERENCES shifts_employees(id), store_id TEXT REFERENCES shifts_stores(id), PRIMARY KEY(employee_id,store_id));
    CREATE TABLE IF NOT EXISTS shifts_turns (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES shifts_stores(id), role TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity > 0), status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts_invitations (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts_turns(id), employee_id TEXT NOT NULL REFERENCES shifts_employees(id), status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(shift_id,employee_id));
    CREATE TABLE IF NOT EXISTS shifts_applications (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts_turns(id), employee_id TEXT NOT NULL REFERENCES shifts_employees(id), status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, UNIQUE(shift_id,employee_id));
    CREATE TABLE IF NOT EXISTS shifts_assignments (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts_turns(id), employee_id TEXT NOT NULL REFERENCES shifts_employees(id), UNIQUE(shift_id,employee_id));
    CREATE TABLE IF NOT EXISTS shifts_events (id TEXT PRIMARY KEY, message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shifts_webhook_events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS shifts_turns_dates ON shifts_turns(starts_at,ends_at);
  `);
  if (!connection.prepare("SELECT 1 FROM shifts_settings WHERE key='internal_token'").get()) {
    connection.prepare('INSERT OR IGNORE INTO shifts_settings VALUES (?,?)').run('internal_token', randomBytes(32).toString('hex'));
  }
  return connection;
}

export function setting(key: string) {
  return (db().prepare('SELECT value FROM shifts_settings WHERE key=?').get(key) as {value:string}|undefined)?.value || '';
}
export function setSetting(key: string, value: string) {
  db().prepare('INSERT INTO shifts_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
}
export const id = () => randomUUID();
export const hash = (value:string) => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export function event(message:string) {
  db().prepare('INSERT INTO shifts_events VALUES (?,?,?)').run(id(),message,now());
}
export function transaction<T>(work:()=>T):T {
  const conn=db(); conn.exec('BEGIN IMMEDIATE');
  try { const value=work(); conn.exec('COMMIT'); return value; }
  catch (error) { conn.exec('ROLLBACK'); throw error; }
}

export type Shift = { id:string; store_id:string; store_name:string; role:string; starts_at:string; ends_at:string; capacity:number; assigned:number; pending:number; status:string };
export type Employee = { id:string; name:string; phone:string; active:number; store_ids:string[] };
export type Application = { id:string; shift_id:string; employee_id:string; name:string; phone:string; store_name:string; role:string; starts_at:string; ends_at:string; status:string };
export function snapshot() {
  const conn=db();
  const employees=conn.prepare('SELECT * FROM shifts_employees ORDER BY name').all() as Omit<Employee,'store_ids'>[];
  const links=conn.prepare('SELECT * FROM shifts_employee_stores').all() as {employee_id:string;store_id:string}[];
  return {
    stores: conn.prepare('SELECT * FROM shifts_stores ORDER BY name').all() as {id:string;name:string;address:string}[],
    employees: employees.map(e=>({...e,store_ids:links.filter(l=>l.employee_id===e.id).map(l=>l.store_id)})),
    shifts: conn.prepare(`SELECT t.*,s.name store_name,
      (SELECT count(*) FROM shifts_assignments a WHERE a.shift_id=t.id) assigned,
      (SELECT count(*) FROM shifts_applications a WHERE a.shift_id=t.id AND a.status='pending') pending
      FROM shifts_turns t JOIN shifts_stores s ON s.id=t.store_id ORDER BY starts_at`).all() as Shift[],
    applications: conn.prepare(`SELECT a.*,e.name,e.phone,s.name store_name,t.role,t.starts_at,t.ends_at FROM shifts_applications a
      JOIN shifts_employees e ON e.id=a.employee_id JOIN shifts_turns t ON t.id=a.shift_id JOIN shifts_stores s ON s.id=t.store_id
      ORDER BY a.created_at DESC`).all() as Application[],
    assignments: conn.prepare('SELECT a.*,e.name FROM shifts_assignments a JOIN shifts_employees e ON e.id=a.employee_id').all() as {id:string;shift_id:string;employee_id:string;name:string}[],
    events: conn.prepare('SELECT * FROM shifts_events ORDER BY created_at DESC LIMIT 50').all() as {id:string;message:string;created_at:string}[],
    settings: { adminPhone:setting('admin_phone'), session:setting('openwa_session'), configured:!!setting('admin_phone')&&!!setting('openwa_session') },
  };
}

function eligible(employeeId:string, shiftId:string) {
  const shift=db().prepare("SELECT * FROM shifts_turns WHERE id=? AND status='open'").get(shiftId) as {store_id:string;starts_at:string;ends_at:string}|undefined;
  if (!shift || new Date(shift.starts_at).getTime()<=Date.now()) throw new Error('El turno no está disponible o ya comenzó.');
  if (!db().prepare('SELECT 1 FROM shifts_employees e JOIN shifts_employee_stores es ON es.employee_id=e.id WHERE e.id=? AND e.active=1 AND es.store_id=?').get(employeeId,shift.store_id)) throw new Error('El empleado no está habilitado para esta tienda.');
  if (db().prepare(`SELECT 1 FROM shifts_assignments a JOIN shifts_turns t ON t.id=a.shift_id
    WHERE a.employee_id=? AND t.status='open' AND t.starts_at<? AND t.ends_at>?`).get(employeeId,shift.ends_at,shift.starts_at)) throw new Error('El empleado tiene un turno solapado.');
}
export function candidates(shiftId:string) {
  return snapshot().employees.filter(e=> {
    if (db().prepare("SELECT 1 FROM shifts_invitations WHERE shift_id=? AND employee_id=? AND status!='failed'").get(shiftId,e.id)) return false;
    try { eligible(e.id,shiftId); return true; } catch { return false; }
  });
}
export function apply(invitationId:string) {
  return transaction(()=> {
    const invitation=db().prepare("SELECT * FROM shifts_invitations WHERE id=? AND status='sent'").get(invitationId) as {shift_id:string;employee_id:string}|undefined;
    if (!invitation) throw new Error('La invitación no está pendiente.');
    eligible(invitation.employee_id,invitation.shift_id);
    const shift=snapshot().shifts.find(t=>t.id===invitation.shift_id)!;
    if(shift.assigned>=shift.capacity)throw new Error('El turno ya está cubierto.');
    const applicationId=id();
    db().prepare('INSERT INTO shifts_applications VALUES (?,?,?,?,?)').run(applicationId,invitation.shift_id,invitation.employee_id,'pending',now());
    db().prepare("UPDATE shifts_invitations SET status='accepted' WHERE id=?").run(invitationId);
    event('Se recibió una postulación. Pendiente de aprobación del administrador.');
    return applicationId;
  });
}
export function decide(applicationId:string, decision:'approved'|'rejected', actor:string) {
  return transaction(()=> {
    const application=db().prepare('SELECT * FROM shifts_applications WHERE id=?').get(applicationId) as {status:string;shift_id:string;employee_id:string}|undefined;
    if (!application) throw new Error('Postulación no encontrada.');
    if (application.status===decision) return {ok:true,changed:false};
    if (application.status!=='pending') throw new Error('Esta postulación ya fue resuelta.');
    if (decision==='approved') {
      eligible(application.employee_id,application.shift_id);
      const shift=snapshot().shifts.find(t=>t.id===application.shift_id)!;
      if (shift.assigned>=shift.capacity) throw new Error('El turno ya tiene todas sus plazas cubiertas.');
      db().prepare('INSERT INTO shifts_assignments VALUES (?,?,?)').run(id(),application.shift_id,application.employee_id);
    }
    db().prepare('UPDATE shifts_applications SET status=? WHERE id=?').run(decision,applicationId);
    event(`${actor}: postulación ${decision==='approved'?'aprobada':'rechazada'} (${applicationId}).`);
    return {ok:true,changed:true};
  });
}
