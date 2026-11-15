import { z } from 'zod';
import { currentUser,assertOrigin } from '../../../../lib/auth';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
export const runtime='nodejs';
export async function POST(request:Request){
  const headers={'Cache-Control':'private, no-store'};
  if(!await currentUser())return Response.json({error:'Inicia sesión o abre un enlace de recuperación válido.'},{status:401,headers});
  try{
    assertOrigin(request);
    const {password}=z.object({password:z.string().min(12).max(200)}).parse(await request.json());
    const supabase=await createSupabaseServerClient();
    const {error}=await supabase.auth.updateUser({password});
    if(error){
      if(error.code==='same_password')return Response.json({error:'La nueva contraseña debe ser distinta de la actual.'},{status:400,headers});
      if(error.code==='weak_password')return Response.json({error:'La contraseña no cumple la política de seguridad de Supabase. Usa al menos 12 caracteres y combina letras, números y símbolos.'},{status:400,headers});
      if(error.status===401||error.code==='session_not_found')return Response.json({error:'La sesión de recuperación venció. Solicita otro enlace.'},{status:401,headers});
      return Response.json({error:'Supabase no pudo guardar la contraseña. Inténtalo de nuevo o solicita otro enlace.'},{status:400,headers});
    }
    return Response.json({ok:true},{headers});
  }catch{return Response.json({error:'No se pudo actualizar. Usa una contraseña distinta, con al menos 12 caracteres.'},{status:400,headers});}
}
