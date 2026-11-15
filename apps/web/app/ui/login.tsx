'use client';
import { useState } from 'react';
import { ArrowUpRight,CalendarDays,ShieldCheck } from 'lucide-react';
export default function Login() {
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [username,setUsername]=useState('');const [notice,setNotice]=useState('');
  async function submit(form:FormData) {
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});
      const data=await response.json();if(!response.ok) throw new Error(data.error);
      window.location.reload();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo conectar.');}finally{setBusy(false);}
  }
  async function email(action:'recover'|'resend'){
    if(!username.trim()){setError('Escribe tu usuario o correo primero.');return;}
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,action})});
      const body=await response.json();if(!response.ok)throw new Error(body.error);setNotice(body.message);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo solicitar el correo.');}finally{setBusy(false);}
  }
  return <main className="login"><section className="login-story"><a className="brand" href="/"><span className="brand-mark"><CalendarDays size={23}/></span>turno<span className="brand-dot">.</span></a><div><span className="eyebrow">MENOS COORDINACIÓN. MÁS EQUIPO.</span><h1>Cada turno.<br/>La persona<br/><em>indicada.</em></h1><p>Tu calendario, tu equipo y un agente que se encarga de encontrar quién puede ayudarte.</p></div><span className="login-foot">HECHO PARA EL RITMO DE TU TIENDA</span></section><section className="login-panel"><div className="login-box"><span className="tag"><ShieldCheck size={14}/> SUPABASE AUTH · ADMINISTRADOR</span><h2>Qué bueno verte.</h2><p>Inicia sesión para organizar el próximo turno.</p><form action={submit}><label>Usuario o correo<input name="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required autoFocus/></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required/></label>{error?<div className="error" role="alert">{error}</div>:null}{notice?<div className="success" role="status">{notice}</div>:null}<button className="primary" disabled={busy}>{busy?'Procesando…':'Entrar al calendario'}<ArrowUpRight size={18}/></button><button className="text-button" type="button" disabled={busy} onClick={()=>email('recover')}>Olvidé mi contraseña</button><button className="text-button" type="button" disabled={busy} onClick={()=>email('resend')}>Reenviar confirmación de correo</button></form><p className="muted small">Acceso privado · Las asignaciones siempre necesitan tu aprobación.</p></div></section></main>;
}
