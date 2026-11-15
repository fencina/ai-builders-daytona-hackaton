import { currentUser,assertOrigin } from '../../../lib/auth';
import { operation } from '../../../lib/operations';
import { snapshot } from '../../../../../packages/db';
export const runtime='nodejs';
export async function GET() {
  if(!await currentUser()) return Response.json({error:'No autorizado.'},{status:401});
  return Response.json(snapshot());
}
export async function POST(request:Request) {
  const user=await currentUser();
  if(!user) return Response.json({error:'No autorizado.'},{status:401});
  try {
    assertOrigin(request);
    const {action,input}=await request.json();
    const result=await operation(action,input,user.username);
    return Response.json(result);
  } catch(error) { return Response.json({error:error instanceof Error?error.message:'No se pudo completar la operación.'},{status:400}); }
}
