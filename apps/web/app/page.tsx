import { currentUser } from '../lib/auth';
import { snapshot } from '../../../packages/db';
import Dashboard from './ui/dashboard';
import Login from './ui/login';
import AuthLanding from './ui/auth-landing';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function Page({searchParams}:{searchParams:Promise<{authError?:string}>}) {
  const params=await searchParams;
  const user=await currentUser();
  if(!user) return <><AuthLanding/><Login initialError={params.authError==='expired'?'El enlace venció o ya fue utilizado. Solicita un enlace nuevo desde Recuperar contraseña.':''}/></>;
  return <><AuthLanding/><Dashboard initial={await snapshot()} username={user.username}/></>;
}
