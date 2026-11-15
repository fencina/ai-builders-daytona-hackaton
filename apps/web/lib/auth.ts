import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { createSupabaseServerClient } from './supabase/server';
import { adminConfig } from './supabase/config';

export const currentUser=cache(async()=>{
  if(!(await cookies()).getAll().some(c=>c.name.startsWith('sb-')&&c.name.includes('-auth-token')))return null;
  const supabase=await createSupabaseServerClient();
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return null;
  const admin=adminConfig();
  // Authentication is not authorization: only this pinned, verified identity is admin.
  // Never trust user_metadata, a username in the request, or an arbitrary authenticated user.
  if(user.id!==admin.userId||!user.email_confirmed_at||user.email?.toLowerCase()!==admin.email)return null;
  return {id:user.id,username:admin.username,email:user.email};
});
export async function login(username:string,password:string) {
  const admin=adminConfig();
  const identifier=username.trim().toLowerCase();
  const email=identifier===admin.username.toLowerCase()?admin.email:identifier;
  if(email!==admin.email)throw new Error('Usuario o contraseña incorrectos.');
  const supabase=await createSupabaseServerClient();
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error) {
    if(error.code==='email_not_confirmed')throw new Error('Confirma tu correo electrónico antes de iniciar sesión.');
    if(error.status===429)throw new Error('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
    throw new Error('Usuario o contraseña incorrectos.');
  }
  if(data.user.id!==admin.userId||!data.user.email_confirmed_at||data.user.email?.toLowerCase()!==admin.email){
    await supabase.auth.signOut({scope:'local'});
    throw new Error('Esta cuenta no tiene permisos de administrador.');
  }
  (await cookies()).delete('turno_session');
}
export async function logout() {
  const supabase=await createSupabaseServerClient();
  const {error}=await supabase.auth.signOut({scope:'local'});
  if(error)throw new Error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
  (await cookies()).delete('turno_session');
}
export function assertOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(!origin)throw new Error('Origen no permitido.');
  // Next may normalize request.url to localhost in production. Validate against the
  // browser-controlled request authority, not that internal URL. For a reverse proxy,
  // configure one explicit public origin instead of trusting forwarded headers.
  const allowed=process.env.APP_ORIGIN;
  const parsed=new URL(origin);
  if(allowed ? parsed.origin!==new URL(allowed).origin : parsed.host!==request.headers.get('host')) throw new Error('Origen no permitido.');
}
