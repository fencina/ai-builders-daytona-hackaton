import 'server-only';
import type { User } from '@supabase/supabase-js';
import { adminConfig } from './config';

export function isAdministrator(user:User|null){
  if(!user)return false;
  const admin=adminConfig();
  return user.id===admin.userId&&!!user.email_confirmed_at&&user.email?.toLowerCase()===admin.email;
}
