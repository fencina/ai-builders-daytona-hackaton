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

export type Administrator={userId:string;email:string;username:string};

export function administrators():Administrator[]{
  let additional:unknown=[];
  try{additional=JSON.parse(process.env.SUPABASE_ADDITIONAL_ADMINS||'[]');}
  catch{throw new Error('La configuración de administradores adicionales no es válida.');}
  if(!Array.isArray(additional))throw new Error('La configuración de administradores adicionales debe ser una lista.');
  const accounts:Administrator[]=[];
  const ids=new Set<string>();const emails=new Set<string>();const aliases=new Set<string>();
  for(const entry of [adminConfig(),...additional]){
    if(!entry||typeof entry!=='object'||typeof entry.userId!=='string'||typeof entry.email!=='string'||typeof entry.username!=='string')throw new Error('Identidad administrativa incompleta.');
    const account={userId:entry.userId.trim().toLowerCase(),email:entry.email.trim().toLowerCase(),username:entry.username.trim().toLowerCase()};
    if(!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(account.userId)||!/^\S+@[^\s@]+\.[^\s@]+$/.test(account.email)||!/^[a-z0-9_-]{2,50}$/.test(account.username))throw new Error('Identidad administrativa inválida.');
    if(ids.has(account.userId)||emails.has(account.email)||aliases.has(account.username))throw new Error('Hay administradores con identidades o alias duplicados.');
    ids.add(account.userId);emails.add(account.email);aliases.add(account.username);accounts.push(account);
  }
  return accounts;
}

export function findAdministrator(identifier:string){
  const value=identifier.trim().toLowerCase();
  return administrators().find(account=>account.email===value||account.username===value);
}
