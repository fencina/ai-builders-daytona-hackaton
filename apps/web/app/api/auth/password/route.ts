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
    if(error)throw new Error('No se pudo actualizar. Usa una contraseña distinta, con al menos 12 caracteres.');
    return Response.json({ok:true},{headers});
  }catch{return Response.json({error:'No se pudo actualizar. Usa una contraseña distinta, con al menos 12 caracteres.'},{status:400,headers});}
}
