// Runs against an isolated SQLite file and a local OpenWA stub. Never sends real messages.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes,createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const folder=mkdtempSync(path.join(tmpdir(),'turno-integration-'));
process.env.SHIFTS_DATABASE_PATH=path.join(folder,'app.db');
const {db,id,snapshot}=await import('../../../packages/db/index.ts');
const password=randomBytes(18).toString('hex');
const adminId=id();const email='admin@example.test';
const user={id:adminId,aud:'authenticated',role:'authenticated',email,email_confirmed_at:new Date().toISOString(),app_metadata:{},user_metadata:{},identities:[],created_at:new Date().toISOString()};
const otherUser={...user,id:id(),email:'other@example.test',user_metadata:{role:'admin'}};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor=u=>`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:u.id,aud:'authenticated',role:'authenticated',email:u.email,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.test-signature`;
const accessToken=tokenFor(user);const otherToken=tokenFor(otherUser);
let revoked=false;
const session={access_token:accessToken,token_type:'bearer',refresh_token:'test-refresh-token',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
const authStub=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  res.setHeader('Content-Type','application/json');
  const reply=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if(req.url.startsWith('/auth/v1/token')&&req.method==='POST'){
    if(body.email!==email||body.password!==password)return reply(400,{error_code:'invalid_credentials',msg:'Invalid credentials'});
    revoked=false;return reply(200,session);
  }
  if(req.url==='/auth/v1/user'){
    if(req.headers.authorization===`Bearer ${otherToken}`)return reply(200,otherUser);
    if(!revoked&&req.headers.authorization===`Bearer ${accessToken}`)return reply(200,user);
    return reply(401,{code:'bad_jwt',msg:'Invalid token'});
  }
  if(req.url.startsWith('/auth/v1/logout')){revoked=true;res.statusCode=204;return res.end();}
  return reply(404,{msg:'Not found'});
});
await new Promise(resolve=>authStub.listen(0,'127.0.0.1',resolve));
const sent=[];
const stub=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;sent.push({url:req.url,body:JSON.parse(text)});res.setHeader('Content-Type','application/json');res.end('{"id":"stub-message"}');});
await new Promise(resolve=>stub.listen(0,'127.0.0.1',resolve));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`;const secret=randomBytes(32).toString('hex');
const child=spawn(process.execPath,['apps/web/node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port',String(port)],{
  cwd:process.cwd(),env:{...process.env,APP_ORIGIN:base,ADMIN_USERNAME:'test-admin',SUPABASE_URL:`http://127.0.0.1:${authStub.address().port}`,SUPABASE_PUBLISHABLE_KEY:'test-publishable-key',SUPABASE_ADMIN_EMAIL:email,SUPABASE_ADMIN_USER_ID:adminId,OPENWA_URL:`http://127.0.0.1:${stub.address().port}`,OPENWA_API_KEY:'test-only',OPENWA_WEBHOOK_SECRET:secret},stdio:['ignore','pipe','pipe'],
});
let logs='';child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
let cookie='';
async function request(url,method='GET',body,origin=base){
  return fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}: {})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function operation(action,input){const r=await request('/api/manage','POST',{action,input});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
async function webhook(from,body,key=id(),valid=true){
  const raw=JSON.stringify({event:'message.received',timestamp:new Date().toISOString(),sessionId:'test-session',idempotencyKey:key,data:{from,body,fromMe:false}});
  return fetch(base+'/api/webhooks/openwa',{method:'POST',headers:{'Content-Type':'application/json','x-openwa-signature':valid?`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`:'invalid'},body:raw});
}
try{
  let ready=false;
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(250);}
  assert.ok(ready,logs);
  assert.equal((await request('/api/manage')).status,401);
  assert.equal((await request('/api/internal','POST',{action:'snapshot'})).status,401);
  assert.equal((await request('/api/auth/password','POST',{password:'not-allowed-before-login'})).status,401);
  assert.equal((await request('/api/auth','POST',{username:'test-admin',password},'https://evil.invalid')).status,400);
  assert.equal((await request('/api/auth','POST',{username:'test-admin',password:'wrong-password'})).status,400);
  const auth=await request('/api/auth','POST',{username:'test-admin',password});assert.equal(auth.status,200,await auth.text());
  cookie=auth.headers.getSetCookie().filter(c=>c.startsWith('sb-')).map(c=>c.split(';')[0]).join('; ');assert.ok(cookie);assert.ok(auth.headers.get('set-cookie').includes('HttpOnly'));
  const authenticatedCookie=cookie;
  cookie='turno_session=legacy-cookie';assert.equal((await request('/api/manage')).status,401);
  const cookieName=authenticatedCookie.split('=')[0];
  cookie=`${cookieName}=base64-${encode({...session,access_token:otherToken,user:otherUser})}`;
  assert.equal((await request('/api/manage')).status,401,'other authenticated users cannot become admin through user_metadata');
  cookie=`${cookieName}=base64-${encode({...session,access_token:'forged-token'})}`;
  assert.equal((await request('/api/manage')).status,401,'forged session data is never trusted');
  cookie=authenticatedCookie;
  assert.equal((await request('/api/manage')).status,200);
  assert.match((await request('/api/manage')).headers.get('cache-control'),/no-store/);
  assert.equal((await request('/api/manage','POST',{action:'store',input:{name:'Wrong origin'}},'https://evil.invalid')).status,400);
  await operation('store',{name:'Integration store',address:'Test only'});
  const storeId=snapshot().stores[0].id;
  await operation('employee',{name:'Integration employee',phone:'5491100000001',storeIds:[storeId]});
  await operation('settings',{adminPhone:'5491100000002',session:'test-session'});
  const startsAt=new Date(Date.now()+86400000).toISOString();const endsAt=new Date(Date.now()+115200000).toISOString();
  await operation('shift',{storeId,role:'Caja',startsAt,endsAt,capacity:1});
  assert.equal(sent.length,1,'a new vacant shift automatically invites an employee');
  assert.ok(sent[0].url.endsWith('/messages/send-text'));
  const invitation=db().prepare('SELECT * FROM shifts_invitations').get();
  assert.equal(invitation.status,'sent');
  const duplicateSearch=await request('/api/manage','POST',{action:'search',input:{shiftId:invitation.shift_id}});
  assert.equal(duplicateSearch.status,400);assert.equal(sent.length,1);
  assert.equal((await webhook('5491100000001@c.us',`SI ${invitation.id}`,id(),false)).status,401);
  await webhook('5491100000003@c.us',`SI ${invitation.id}`);assert.equal(snapshot().applications.length,0,'unknown senders cannot accept');
  await webhook('5491100000001@lid',`SI ${invitation.id}`);assert.equal(snapshot().applications.length,0,'privacy IDs are not mistaken for phone numbers');
  const key=id();await webhook('5491100000001@c.us',`SI ${invitation.id}`,key);
  assert.equal(snapshot().applications.length,1);assert.equal(snapshot().shifts[0].assigned,0);
  assert.ok(sent.some(m=>m.body.chatId==='5491100000002@c.us'&&m.body.text.includes('Encontré un postulante')));
  const replay=await webhook('5491100000001@c.us',`SI ${invitation.id}`,key);assert.equal((await replay.json()).duplicate,true);
  const application=snapshot().applications[0];
  await webhook('5491100000002@c.us',`APROBAR ${application.id}`);
  assert.equal(snapshot().applications[0].status,'approved');assert.equal(snapshot().shifts[0].assigned,1);
  await operation('decision',{applicationId:application.id,decision:'approved'});assert.equal(snapshot().assignments.length,1);
  await request('/api/auth','DELETE');assert.equal((await request('/api/manage')).status,401);
  console.log('PASS: Supabase login, HttpOnly cookies, legacy-cookie rejection, forged-session rejection, administrator authorization, protected APIs, no-store, CSRF, store/employee/shift creation, automatic invitations, signature validation, sender checks, replay protection, employee application, administrator notification, WhatsApp approval, idempotent web approval, logout.');
  console.log('SQLite was isolated; Supabase Auth and WhatsApp were local stubs. Real email confirmation is a separate manual step.');
}finally{
  child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
  await new Promise(resolve=>stub.close(resolve));await new Promise(resolve=>authStub.close(resolve));db().close();rmSync(folder,{recursive:true,force:true});
}
