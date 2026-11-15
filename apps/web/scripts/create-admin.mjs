// Run once with environment variables. Uses only the publishable key and Auth API.
// Does not write directly into auth.users or bypass email confirmation.
import { createClient } from '@supabase/supabase-js';
const {SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:key,SUPABASE_ADMIN_EMAIL:email,ADMIN_PASSWORD:password}=process.env;
if(!url||!key||!email||!password)throw new Error('Define SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ADMIN_EMAIL y ADMIN_PASSWORD.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:process.env.AUTH_CONFIRM_REDIRECT_URL||'http://localhost:3000/auth/confirmed'}});
if(error){console.error(`No se pudo crear la cuenta: ${error.code||'auth_error'}.`);process.exitCode=1;}
else if(!data.user||data.user.identities?.length===0){console.error('La cuenta podría existir. No se cambió su contraseña. Verifica el usuario en Supabase antes de configurar el ID.');process.exitCode=1;}
else console.log(JSON.stringify({userId:data.user.id,email:data.user.email,confirmationRequired:!data.user.email_confirmed_at}));
