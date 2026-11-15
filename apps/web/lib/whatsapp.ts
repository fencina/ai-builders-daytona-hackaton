import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot,setting } from '../../../packages/db';

export async function sendWhatsApp(phone:string,text:string) {
  const session=setting('openwa_session');
  if(!session || !phone) throw new Error('WhatsApp no está configurado.');
  const key=process.env.OPENWA_API_KEY || readFileSync(path.join(projectRoot,'apps/openwa/data/.api-key'),'utf8').trim();
  const response=await fetch(`${process.env.OPENWA_URL||'http://127.0.0.1:2785'}/api/sessions/${encodeURIComponent(session)}/messages/send-text`,{
    method:'POST',headers:{'Content-Type':'application/json','X-API-Key':key},
    body:JSON.stringify({chatId:`${phone.replace(/\D/g,'')}@c.us`,text}),signal:AbortSignal.timeout(20000),
  });
  if(!response.ok) throw new Error(`OpenWA respondió ${response.status}.`);
}
