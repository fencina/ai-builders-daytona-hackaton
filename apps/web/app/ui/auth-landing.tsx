'use client';
import { useEffect } from 'react';

export default function AuthLanding(){
  useEffect(()=>{
    const url=new URL(window.location.href);const hash=new URLSearchParams(url.hash.slice(1));
    // Supabase may fall back to Site URL (/) when the requested redirect isn't allowlisted.
    // Preserve valid recovery material for the dedicated verifier instead of ignoring it.
    if(hash.get('type')==='recovery'||hash.has('error')||url.searchParams.has('code')||url.searchParams.has('token_hash')||url.searchParams.has('error_code')){
      window.location.replace(`/auth/callback${url.search}${url.hash}`);
    }
  },[]);
  return null;
}
