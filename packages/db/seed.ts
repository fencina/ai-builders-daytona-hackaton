import { db } from './index.ts';

db();
console.log('Esquema de negocio inicializado. El acceso se gestiona con Supabase Auth, no con usuarios SQLite.');
