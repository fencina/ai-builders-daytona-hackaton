'use client';
import { useEffect } from 'react';
export default function Confirmed(){
  // Confirmation links may contain implicit-flow tokens. Do not consume or retain them.
  useEffect(()=>{window.history.replaceState(null,'','/auth/confirmed');},[]);
  return <main className="login-panel" style={{minHeight:'100dvh'}}><section className="login-box"><span className="tag">SUPABASE AUTH</span><h2>Revisa tu confirmación.</h2><p>Si Supabase confirmó tu correo, ya puedes iniciar sesión con tu contraseña. Si el enlace venció, solicita otro desde la pantalla de acceso.</p><a href="/" className="primary">Volver al acceso</a></section></main>;
}
