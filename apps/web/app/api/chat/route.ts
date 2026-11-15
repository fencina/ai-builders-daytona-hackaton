import { z } from 'zod';
import { currentUser,assertOrigin } from '../../../lib/auth';
import { askAgent } from '../../../lib/agent';
export const runtime='nodejs';
export async function POST(request:Request) {
  if(!await currentUser())return Response.json({error:'No autorizado.'},{status:401});
  try{
    assertOrigin(request);
    const body=z.object({messages:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().min(1).max(5000)})).min(1).max(30)}).parse(await request.json());
    return Response.json({text:await askAgent(body.messages.map(m=>({role:m.role,content:m.text})))});
  }catch{return Response.json({error:'No se pudo consultar al agente. Comprueba que Mastra está activo y tiene configurada OPENAI_API_KEY.'},{status:503});}
}
