import { registerApiRoute } from '@mastra/core/server';
import { RequestContext } from '@mastra/core/request-context';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { setting } from '../../../packages/db';

export const shiftChatRoute=registerApiRoute('/internal/shift-chat',{
  method:'POST',
  handler:async c=>{
    const expected=Buffer.from(`Bearer ${setting('internal_token')}`);
    const actual=Buffer.from(c.req.header('authorization')||'');
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return c.json({error:'No autorizado.'},401);
    const parsed=z.object({messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(5000)})).min(1).max(30)}).safeParse(await c.req.json());
    if(!parsed.success)return c.json({error:'Mensajes inválidos.'},400);
    try{
      const requestContext=new RequestContext();
      requestContext.set('shift-admin-token',setting('internal_token'));
      const response=await c.get('mastra').getAgent('shiftAgent').generate([
        {role:'system' as const,content:`Fecha actual: ${new Date().toISOString()}.`},
        ...parsed.data.messages.map(m=>m.role==='user'?{role:'user' as const,content:m.content}:{role:'assistant' as const,content:m.content}),
      ],{requestContext});
      return c.json({text:response.text});
    }catch{return c.json({error:'El agente no pudo responder. Revisa la API key del modelo y los logs de Mastra.'},503);}
  },
});
