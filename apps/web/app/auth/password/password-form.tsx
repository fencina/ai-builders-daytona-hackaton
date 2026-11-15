'use client';
import { useState } from 'react';
export default function PasswordForm(){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(form:FormData){
    setError('');const password=String(form.get('password'));
    if(password!==form.get('confirmation')){setError('Las contraseñas no coinciden.');return;}
    setBusy(true);
    try{
      const response=await fetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      window.location.assign('/');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar.');}finally{setBusy(false);}
  }
  return <form action={submit}><label>Contraseña nueva<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200}/></label><label>Repetir contraseña<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={200}/></label>{error?<div className="error" role="alert">{error}</div>:null}<button className="primary" disabled={busy}>{busy?'Guardando…':'Actualizar contraseña'}</button></form>;
}
