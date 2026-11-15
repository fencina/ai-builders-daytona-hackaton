import { z } from 'zod';
import { assertOrigin } from '../../../../lib/auth';
import { adminConfig } from '../../../../lib/supabase/config';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';

export const runtime='nodejs';
export async function POST(request:Request){
  const headers={'Cache-Control':'private, no-store'};
  try{
    assertOrigin(request);
    const {username,action}=z.object({username:z.string().trim().min(1).max(200),action:z.enum(['recover','resend'])}).parse(await request.json());
    const admin=adminConfig();const identifier=username.toLowerCase();
    const message='Si la cuenta corresponde al administrador, recibirás un correo con los próximos pasos. Revisa spam y usa únicamente el último enlace recibido. Mantén este navegador para completar la recuperación.';
    if(![admin.username.toLowerCase(),admin.email].includes(identifier))return Response.json({message},{headers});
    const supabase=await createSupabaseServerClient();
    // The CSRF check already verified Origin. Never derive a redirect from arbitrary input.
    const origin=process.env.APP_ORIGIN||request.headers.get('origin')!;
    const {error}=action==='recover'
      ?await supabase.auth.resetPasswordForEmail(admin.email,{redirectTo:`${origin}/auth/callback`})
      :await supabase.auth.resend({type:'signup',email:admin.email,options:{emailRedirectTo:`${origin}/auth/confirmed`}});
    if(error){
      console.warn('Supabase auth email request failed',{code:error.code||'auth_error',status:error.status});
      if(error.status===429||['over_email_send_rate_limit','over_request_rate_limit'].includes(error.code||''))return Response.json({error:'Supabase alcanzó su límite de envío de correos. Espera antes de solicitar otro; el servicio de correo de prueba puede limitar los envíos a 2 por hora.'},{status:429,headers});
      if(['email_address_not_authorized','email_address_invalid'].includes(error.code||''))return Response.json({error:'Supabase no pudo enviar a este correo. Revisa la cuenta administradora y la configuración SMTP del proyecto.'},{status:400,headers});
      return Response.json({error:'No se pudo enviar el correo. Revisa la configuración de correo de Supabase o inténtalo más tarde.'},{status:400,headers});
    }
    return Response.json({message},{headers});
  }catch{return Response.json({error:'No se pudo solicitar el correo.'},{status:400,headers});}
}
