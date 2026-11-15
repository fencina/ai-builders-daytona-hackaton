// Server-only transport for the Turno business data.
// Never import this module from a client component: it reads a secret key.
export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Falta la conexión privada de Supabase en el servidor.');
  return { url: url.replace(/\/$/, ''), key };
}

export async function rest<T>(resource: string, options: RequestInit = {}): Promise<T> {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    ...options,
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    headers: {
      apikey: key,
      // Publishable keys must not travel as a bearer token; secret keys may.
      ...(key.startsWith('eyJ') || key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    const code = typeof error.code === 'string' ? error.code : 'database_error';
    if (code === '23505') throw new Error('Ya existe un registro con esos datos.');
    if (code === '23503') throw new Error('Un registro relacionado no existe.');
    if (code === 'P0001' && typeof error.message === 'string') throw new Error(error.message);
    throw new Error(`No se pudo completar la operación en Supabase (${response.status}, ${code}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Executes one business action inside a single database transaction. */
export async function rpc<T>(action: string, input: unknown): Promise<T> {
  return rest<T>('rpc/turno_execute', {
    method: 'POST',
    body: JSON.stringify({ p_action: action, p_input: input }),
  });
}
