export function authConfig() {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new Error('Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en el servidor.');
  return {url,key};
}

export function adminConfig() {
  const userId=process.env.SUPABASE_ADMIN_USER_ID;
  const email=process.env.SUPABASE_ADMIN_EMAIL?.trim().toLowerCase();
  const username=process.env.ADMIN_USERNAME||'messi';
  if(!userId||!email)throw new Error('Configura la identidad del administrador de Supabase.');
  return {userId,email,username};
}
