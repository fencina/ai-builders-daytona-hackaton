import { timingSafeEqual } from 'node:crypto';
import { setting,snapshot } from '../../../../../packages/db';
import { operation } from '../../../lib/operations';
export const runtime='nodejs';
export async function POST(request:Request) {
  const expected=Buffer.from(`Bearer ${setting('internal_token')}`);
  const actual=Buffer.from(request.headers.get('authorization')||'');
  if(expected.length!==actual.length || !timingSafeEqual(expected,actual)) return Response.json({error:'No autorizado.'},{status:401});
  try {
    const {action,input}=await request.json();
    if(action==='snapshot') return Response.json(snapshot());
    if(!['search','decision'].includes(action)) throw new Error('Acción no admitida.');
    return Response.json(await operation(action,input,'Administrador vía agente'));
  } catch(error) {return Response.json({error:error instanceof Error?error.message:'Operación fallida.'},{status:400});}
}
