'use client';
import { useState } from 'react';
export default function RecoveryRequest(){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  async function submit(form:FormData){
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.get('username'),action:'recover'})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);
      setNotice(body.message);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo solicitar el correo.');}finally{setBusy(false);}
  }
  return <main className="login-panel" style={{minHeight:'100dvh'}}><section className="login-box"><span className="tag">RECUPERAR CONTRASEÑA</span><h2>Volvamos a entrar.</h2><p>Escribe tu usuario o correo de administrador. No necesitas tu contraseña actual.</p><form action={submit}><label>Usuario o correo<input name="username" autoComplete="username" placeholder="messi o tu correo" required maxLength={200}/></label>{error?<div className="error" role="alert">{error}</div>:null}{notice?<div className="success" role="status">{notice}</div>:null}<button className="primary" disabled={busy}>{busy?'Solicitando correo…':'Enviar enlace de recuperación'}</button></form><p className="muted small">Usa el último correo recibido. Abre el enlace en este navegador si contiene un código PKCE. Un enlace ya abierto o vencido no puede reutilizarse.</p><a href="/" className="text-button">Volver al inicio de sesión</a></section></main>;
}
