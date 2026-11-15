import { currentUser } from '../lib/auth';
import { snapshot } from '../../../packages/db';
import Dashboard from './ui/dashboard';
import Login from './ui/login';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function Page() {
  const user=await currentUser();
  if(!user) return <Login/>;
  return <Dashboard initial={snapshot()} username={user.username}/>;
}
