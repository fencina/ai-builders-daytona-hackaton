import 'server-only';
import { setting } from '../../../packages/db';
export async function askAgent(messages:{role:'user'|'assistant';content:string}[]) {
  const response=await fetch(`${process.env.MASTRA_URL||'http://127.0.0.1:4111'}/internal/shift-chat`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${setting('internal_token')}`},
    body:JSON.stringify({messages}),signal:AbortSignal.timeout(120000),
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'El agente no está disponible.');
  return result.text as string;
}
