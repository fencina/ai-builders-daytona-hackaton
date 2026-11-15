import { z } from 'zod';
import { assertOrigin } from '../../../../lib/auth';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { isAdministrator } from '../../../../lib/supabase/authorization';

export const runtime='nodejs';
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('code'),code:z.string().min(1).max(4096)}),
  z.object({action:z.literal('token'),tokenHash:z.string().min(1).max(4096)}),
  z.object({action:z.literal('session'),accessToken:z.string().min(1).max(16384),refreshToken:z.string().min(1).max(4096)}),
]);
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function POST(request:Request){
  try{
    assertOrigin(request);
    const parsed=input.safeParse(await request.json());
    if(!parsed.success)return Response.json({error:'El enlace de recuperación está incompleto. Solicita uno nuevo.'},{status:400,headers});
    const value=parsed.data;const supabase=await createSupabaseServerClient();
    const {error}=value.action==='code'
      ?await supabase.auth.exchangeCodeForSession(value.code)
      :value.action==='token'
        ?await supabase.auth.verifyOtp({token_hash:value.tokenHash,type:'recovery'})
        :await supabase.auth.setSession({access_token:value.accessToken,refresh_token:value.refreshToken});
    if(error){
      const missingVerifier=['pkce_code_verifier_not_found','flow_state_not_found','bad_code_verifier','flow_state_expired'].includes(error.code||'');
      return Response.json({error:missingVerifier?'Abre este enlace en el mismo navegador donde solicitaste la recuperación (sin cambiar entre localhost y 127.0.0.1), o solicita un enlace nuevo desde ese navegador.':'El enlace venció o ya fue utilizado. Solicita uno nuevo y abre únicamente el último correo.'},{status:400,headers});
    }
    // Do not trust users embedded in tokens: validate with Supabase, then enforce admin identity.
    const {data:{user},error:userError}=await supabase.auth.getUser();
    if(userError||!isAdministrator(user)){
      await supabase.auth.signOut({scope:'local'});
      return Response.json({error:'Este enlace no corresponde a la cuenta administradora.'},{status:403,headers});
    }
    return Response.json({ok:true},{headers});
  }catch{return Response.json({error:'No se pudo verificar el enlace. Solicita uno nuevo desde la aplicación.'},{status:400,headers});}
}
