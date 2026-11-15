import { createServerClient } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
import { authConfig } from './lib/supabase/config';

export async function proxy(request:NextRequest) {
  let response=NextResponse.next({request});
  response.headers.set('Cache-Control','private, no-store');
  // The page shows login even before configuration, but no protected API grants access.
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)return response;
  // Login/logout/recovery persist cookies themselves. Never run a simultaneous refresh there.
  if(request.nextUrl.pathname.startsWith('/api/auth')||['/auth/callback','/auth/confirmed'].includes(request.nextUrl.pathname))return response;
  if(!request.cookies.getAll().some(c=>c.name.startsWith('sb-')&&c.name.includes('-auth-token')))return response;
  const {url,key}=authConfig();
  const supabase=createServerClient(url,key,{
    cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},
    cookies:{
      getAll:()=>request.cookies.getAll(),
      setAll:(values,cacheHeaders)=>{
        for(const {name,value} of values)request.cookies.set(name,value);
        response=NextResponse.next({request});
        for(const {name,value,options} of values)response.cookies.set(name,value,options);
        for(const [name,value] of Object.entries(cacheHeaders))response.headers.set(name,value);
        response.headers.set('Cache-Control','private, no-store');
      },
    },
  });
  // Refresh and validate; authorization still happens in every protected route with getUser().
  await supabase.auth.getUser();
  return response;
}

export const config={matcher:['/','/api/auth/:path*','/api/manage','/api/chat','/api/openwa-dashboard','/auth/:path*']};
