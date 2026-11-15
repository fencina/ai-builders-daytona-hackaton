import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import PasswordForm from './password-form';
export const dynamic='force-dynamic';
export default async function PasswordPage(){
  if(!await currentUser())redirect('/');
  return <main className="login-panel" style={{minHeight:'100dvh'}}><section className="login-box"><span className="tag">SUPABASE AUTH</span><h2>Una contraseña nueva.</h2><p>Elige al menos 12 caracteres. No se guardará en la base de turnos.</p><PasswordForm/></section></main>;
}
