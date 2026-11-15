import { createHmac,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { claimWebhook,employeeByPhone,event,invitationBelongsTo,setting } from '../../../../../../packages/db';
import { acceptInvitation,declineInvitation,operation } from '../../../../lib/operations';
import { sendWhatsApp } from '../../../../lib/whatsapp';
import { askAgent } from '../../../../lib/agent';

export const runtime='nodejs';
const payloadSchema=z.object({event:z.string(),timestamp:z.string(),sessionId:z.string(),idempotencyKey:z.string().min(1),data:z.object({id:z.unknown().optional(),from:z.string().optional(),fromMe:z.boolean().optional(),body:z.string().max(5000).optional()}).passthrough()});

export async function POST(request:Request) {
  const secret=process.env.OPENWA_WEBHOOK_SECRET;
  if(!secret)return Response.json({error:'Webhook no configurado.'},{status:503});
  const raw=await request.text();if(raw.length>100000)return new Response(null,{status:413});
  const expected=Buffer.from(`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`);
  const actual=Buffer.from(request.headers.get('x-openwa-signature')||'');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return new Response(null,{status:401});
  let parsed;try{parsed=payloadSchema.safeParse(JSON.parse(raw));}catch{return new Response(null,{status:400});}
  if(!parsed.success)return new Response(null,{status:400});
  const payload=parsed.data;
  if(payload.event!=='message.received'||payload.sessionId!==await setting('openwa_session')||payload.data.fromMe)return Response.json({ignored:true});
  const from=payload.data.from||'';
  // Never equate privacy LID digits with a phone number. Groups are not administrative chats.
  if(!/^\d+@(c\.us|s\.whatsapp\.net)$/.test(from))return Response.json({ignored:true});
  const phone=from.split('@')[0];const text=(payload.data.body||'').trim();
  const key=`${payload.sessionId}:${payload.idempotencyKey}`;
  if(!await claimWebhook(key))return Response.json({duplicate:true});
  try{
    if(phone===await setting('admin_phone')){
      const decision=/^(APROBAR|RECHAZAR)\s+([\da-f-]{36})$/i.exec(text);
      if(decision){await operation('decision',{applicationId:decision[2],decision:decision[1].toUpperCase()==='APROBAR'?'approved':'rejected'},'Administrador por WhatsApp');await sendWhatsApp(phone,'Decisión guardada. Puedes revisar el resultado en la web.');}
      else if(text){const answer=await askAgent([{role:'user',content:text}]);await sendWhatsApp(phone,answer.slice(0,4000));}
    }else{
      const employee=await employeeByPhone(phone);
      if(!employee)return Response.json({ignored:true});
      const reply=/^(SI|SÍ|NO)\s+([\da-f-]{36})$/i.exec(text);
      if(!reply){await sendWhatsApp(phone,'Para responder a una invitación, envía SI seguido del código de invitación, o NO seguido del código.');return Response.json({ok:true});}
      if(!await invitationBelongsTo(reply[2],employee.id))return Response.json({ignored:true});
      if(reply[1].toUpperCase()==='NO'){
        await declineInvitation(reply[2],employee.id);
        await sendWhatsApp(phone,'Gracias por avisar. Registramos que no puedes asistir.');
      }else{
        await acceptInvitation(reply[2]);
        await sendWhatsApp(phone,'Registramos tu disponibilidad. Tu postulación está pendiente de aprobación del administrador. Te avisaremos cuando decida.');
      }
    }
    return Response.json({ok:true});
  }catch{
    // Never blindly replay a message after a partially completed side effect.
    await event(`No se completó el procesamiento del mensaje entrante (${key}). Revisar OpenWA y las postulaciones antes de reintentar.`);
    return Response.json({ok:false,reviewRequired:true});
  }
}
