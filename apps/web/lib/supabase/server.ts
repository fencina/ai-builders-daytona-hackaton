import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { authConfig } from './config';

// Each request gets its own client. Tokens never enter browser JavaScript.
export async function createSupabaseServerClient() {
  const {url,key}=authConfig();
  const jar=await cookies();
  return createServerClient(url,key,{
    cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},
    cookies:{
      getAll:()=>jar.getAll(),
      setAll:(values)=>{
        try { for(const {name,value,options} of values)jar.set(name,value,options); }
        catch { /* Server Components are read-only; proxy.ts persists refreshed cookies. */ }
      },
    },
  });
}
