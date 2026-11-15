'use client';
import { useEffect,useRef,useState } from 'react';

type Credential={action:'code';code:string}|{action:'token';tokenHash:string}|{action:'session';accessToken:string;refreshToken:string};
const invalidLink='El enlace venció, ya fue utilizado o no es válido. Solicita un correo nuevo y usa únicamente el último enlace recibido.';

export default function RecoveryCallback(){
  const credential=useRef<Credential|null>(null);
  const [ready,setReady]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const url=new URL(window.location.href);const hash=new URLSearchParams(url.hash.slice(1));
    // Never retain recovery credentials in history, analytics URLs or referrers.
    window.history.replaceState(null,'','/auth/callback');
    if(url.searchParams.has('error')||url.searchParams.has('error_code')||hash.has('error')||hash.has('error_code')){setError(invalidLink);return;}
    if(url.searchParams.get('code'))credential.current={action:'code',code:url.searchParams.get('code')!};
    else if(url.searchParams.get('token_hash')&&url.searchParams.get('type')==='recovery')credential.current={action:'token',tokenHash:url.searchParams.get('token_hash')!};
    else if(hash.get('access_token')&&hash.get('refresh_token')&&hash.get('type')==='recovery')credential.current={action:'session',accessToken:hash.get('access_token')!,refreshToken:hash.get('refresh_token')!};
    // StrictMode may rerun the effect after sanitization: preserve the original ref.
    if(credential.current)setReady(true);else setError(invalidLink);
  },[]);
  async function proceed(){
    if(!credential.current||busy)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/auth/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credential.current)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||invalidLink);
      credential.current=null;window.location.replace('/auth/password');
    }catch(e){setError(e instanceof Error?e.message:invalidLink);setReady(false);}finally{setBusy(false);}
  }
  return <main className="login-panel" style={{minHeight:'100dvh'}}><section className="login-box"><span className="tag">RECUPERACIÓN SEGURA</span><h2>Recupera tu acceso.</h2><p>Confirma que quieres abrir el enlace y elegir una contraseña nueva. No necesitas recordar la anterior.</p>{error?<div className="error" role="alert">{error}</div>:null}{ready?<button className="primary full" disabled={busy} onClick={proceed}>{busy?'Verificando enlace…':'Continuar y crear contraseña'}</button>:null}<p className="small muted">Los enlaces son de un solo uso. No compartas el enlace ni abras varios correos de recuperación.</p><a href="/auth/recover" className="text-button">Solicitar un enlace nuevo</a><br/><a href="/" className="text-button">Volver al inicio de sesión</a></section></main>;
}
