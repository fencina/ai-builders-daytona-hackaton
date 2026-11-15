import { z } from 'zod';
import { login,logout,assertOrigin } from '../../../lib/auth';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request) {
  try {
    assertOrigin(request);
    const body=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(200)}).parse(await request.json());
    await login(body.username,body.password);
    return Response.json({ok:true},{headers});
  } catch(error) { return Response.json({error:error instanceof Error?error.message:'No se pudo iniciar sesión.'},{status:400,headers}); }
}
export async function DELETE(request:Request) {
  try {assertOrigin(request);await logout();return Response.json({ok:true},{headers});}
  catch {return Response.json({error:'No se pudo cerrar la sesión.'},{status:400,headers});}
}
