import 'server-only';
import type { User } from '@supabase/supabase-js';
import { administrators } from './config';

export function administratorFor(user:User|null){
  if(!user?.email_confirmed_at)return undefined;
  return administrators().find(admin=>user.id===admin.userId&&user.email?.toLowerCase()===admin.email);
}

export function isAdministrator(user:User|null){
  return !!administratorFor(user);
}
