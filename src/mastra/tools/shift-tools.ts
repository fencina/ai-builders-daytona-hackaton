import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { setting } from '../../../packages/db';

function authorize(value:unknown) {
  const expected=Buffer.from(setting('internal_token'));
  const actual=Buffer.from(typeof value==='string'?value:'');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual)) throw new Error('Se requiere una sesión administrativa verificada.');
}
async function call(action:string,input:unknown) {
  const response=await fetch(`${process.env.SHIFTS_WEB_URL||'http://127.0.0.1:3000'}/api/internal`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${setting('internal_token')}`},
    body:JSON.stringify({action,input}),signal:AbortSignal.timeout(75000),
  });
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'No se pudo realizar la operación.');
  return data;
}
export const shiftOverviewTool=createTool({
  id:'shift-overview',description:'Consulta tiendas, empleados, turnos, asignaciones y postulaciones actuales. Usa los IDs devueltos, nunca inventes IDs.',
  inputSchema:z.object({}),
  execute:async(_input,{requestContext})=>{authorize(requestContext?.get('shift-admin-token'));return call('snapshot',{});},
});
export const shiftSearchTool=createTool({
  id:'shift-search',description:'Busca cobertura enviando invitaciones reales por WhatsApp a empleados habilitados sin solapamientos. No asigna personas.',
  inputSchema:z.object({shiftId:z.string().uuid()}),
  execute:async(input,{requestContext})=>{authorize(requestContext?.get('shift-admin-token'));return call('search',input);},
});
export const shiftDecisionTool=createTool({
  id:'shift-decision',description:'Aprueba o rechaza una postulación SOLO cuando el administrador lo pide explícitamente. Comprueba cupo y solapamientos.',
  inputSchema:z.object({applicationId:z.string().uuid(),decision:z.enum(['approved','rejected'])}),
  execute:async(input,{requestContext})=>{authorize(requestContext?.get('shift-admin-token'));return call('decision',input);},
});
