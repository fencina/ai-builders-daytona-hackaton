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
    const message='Si la cuenta corresponde al administrador, recibirás un correo con los próximos pasos. Revisa también spam.';
    if(![admin.username.toLowerCase(),admin.email].includes(identifier))return Response.json({message},{headers});
    const supabase=await createSupabaseServerClient();
    // The CSRF check already verified Origin. Never derive a redirect from arbitrary input.
    const origin=process.env.APP_ORIGIN||request.headers.get('origin')!;
    const {error}=action==='recover'
      ?await supabase.auth.resetPasswordForEmail(admin.email,{redirectTo:`${origin}/auth/callback`})
      :await supabase.auth.resend({type:'signup',email:admin.email,options:{emailRedirectTo:`${origin}/auth/confirmed`}});
    if(error)return Response.json({error:'No se pudo enviar el correo. Espera unos minutos e inténtalo de nuevo.'},{status:400,headers});
    return Response.json({message},{headers});
  }catch{return Response.json({error:'No se pudo solicitar el correo.'},{status:400,headers});}
}
