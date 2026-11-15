import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { adminConfig } from '../../../lib/supabase/config';

export const runtime='nodejs';
export async function GET(request:Request){
  const url=new URL(request.url);
  const destination=new URL(process.env.APP_ORIGIN||url.origin);
  const code=url.searchParams.get('code');
  if(code){
    const supabase=await createSupabaseServerClient();
    const {error}=await supabase.auth.exchangeCodeForSession(code);
    if(!error){
      const {data:{user}}=await supabase.auth.getUser();
      const admin=adminConfig();
      if(user?.id===admin.userId&&user.email_confirmed_at&&user.email?.toLowerCase()===admin.email){
        destination.pathname='/auth/password';
        const response=NextResponse.redirect(destination);response.headers.set('Cache-Control','private, no-store');return response;
      }
      await supabase.auth.signOut({scope:'local'});
    }
  }
  destination.pathname='/';destination.searchParams.set('authError','expired');
  const response=NextResponse.redirect(destination);response.headers.set('Cache-Control','private, no-store');return response;
}
