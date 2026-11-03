import { Injectable, BadRequestException } from '@nestjs/common';
import { registerApp } from '@larksuiteoapi/node-sdk';
import { Db } from './db';
const scopes=['docx:document:readonly','docx:document:create','docx:document:write_only','offline_access'];
type Flow={phase:string;url:string;expiresAt:number;message:string;controller:AbortController};
@Injectable()
export class LarkConnect {
 private flows=new Map<string,Flow>();
 constructor(private db:Db){}
 status(user:string){const f=this.flows.get(user);if(!f)return {phase:'idle',url:'',expiresAt:0,message:''};if(f.expiresAt<Date.now()&&!['complete','failed','cancelled'].includes(f.phase)){f.controller.abort();f.phase='expired';f.url='';f.message='授权链接已过期，请重新发起';}return {phase:f.phase,url:f.url,expiresAt:f.expiresAt,message:f.message};}
 async start(user:string){
  const existing=this.status(user);if(['starting','registering','authorizing'].includes(existing.phase))return existing;
  this.flows.get(user)?.controller.abort();const f:Flow={phase:'starting',url:'',expiresAt:Date.now()+600000,message:'正在获取 Lark 授权链接',controller:new AbortController()};this.flows.set(user,f);
  const app=await this.db.setting('lark-app-'+user);
  if(app.appId&&app.appSecret){await this.device(user,f,app);return this.status(user);}
  return new Promise<any>((resolve,reject)=>{
   const timer=setTimeout(()=>{f.controller.abort();f.phase='failed';f.message='获取授权链接超时，请稍后重试';reject(new BadRequestException(f.message));},25000);
   registerApp({createOnly:true,source:'product-studio',signal:f.controller.signal,larkDomain:'accounts.larksuite.com',appPreset:{name:'序构产品工作台'},addons:{preset:false,scopes:{user:scopes}},onQRCodeReady:info=>{if(f.controller.signal.aborted)return;const url=new URL(info.url);if(url.hostname==='open.feishu.cn')url.hostname='open.larksuite.com';f.url=url.toString();f.expiresAt=Date.now()+info.expireIn*1000;f.phase='registering';f.message='在 Lark 页面确认应用授权，然后返回这里继续文档权限授权';clearTimeout(timer);resolve(this.status(user));}}).then(async result=>{
    if(f.controller.signal.aborted)return;
    if(result.user_info?.tenant_brand!=='lark')throw new Error('请使用 Lark 国际版账号完成授权');
    const credentials={appId:result.client_id,appSecret:result.client_secret};await this.db.putSetting('lark-app-'+user,credentials);await this.device(user,f,credentials);
   }).catch(()=>{clearTimeout(timer);if(f.controller.signal.aborted)return;f.phase='failed';f.url='';f.message='Lark 授权未完成或被拒绝，请重新授权';reject(new BadRequestException(f.message));});
  });
 }
 private async device(user:string,f:Flow,app:any){
  try{
   const r=await fetch('https://accounts.larksuite.com/oauth/v1/device_authorization',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(app.appId+':'+app.appSecret).toString('base64')},body:new URLSearchParams({client_id:app.appId,scope:scopes.join(' ')}),signal:AbortSignal.any([f.controller.signal,AbortSignal.timeout(20000)])});const d:any=await r.json();if(!r.ok||d.error||!d.device_code||!(d.verification_uri_complete||d.verification_uri))throw new Error();
   if(f.controller.signal.aborted)return;
   f.phase='authorizing';f.url=d.verification_uri_complete||d.verification_uri;const host=new URL(f.url).hostname;if(!host.endsWith('.larksuite.com'))throw new Error();f.expiresAt=Date.now()+(d.expires_in||240)*1000;f.message='点击链接允许访问你的 Lark 文档，完成后自动绑定';
   void this.poll(user,f,app,d.device_code,Math.max(5,d.interval||5));
  }catch{if(!f.controller.signal.aborted){f.phase='failed';f.url='';f.message='无法获取 Lark 文档授权链接，请稍后重试';throw new BadRequestException(f.message);}}
 }
 private async poll(user:string,f:Flow,app:any,deviceCode:string,interval:number){
  while(Date.now()<f.expiresAt&&!f.controller.signal.aborted){
   await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);f.controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,interval*1000);f.controller.signal.addEventListener('abort',done,{once:true});});if(f.controller.signal.aborted)return;
   try{const r=await fetch('https://open.larksuite.com/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:deviceCode,client_id:app.appId,client_secret:app.appSecret}),signal:AbortSignal.any([f.controller.signal,AbortSignal.timeout(15000)])});const d:any=await r.json();if(f.controller.signal.aborted)return;if(d.access_token&&!d.error){await this.db.putSetting('lark-user-'+user,{...d,expiresAt:Date.now()+(d.expires_in||7200)*1000});f.phase='complete';f.url='';f.message='Lark 文档已授权绑定';return;}if(d.error==='authorization_pending')continue;if(d.error==='slow_down'){interval=Math.min(interval+5,60);continue;}if(['access_denied','expired_token','invalid_grant'].includes(d.error)){f.phase='failed';f.url='';f.message='授权被取消或链接已失效，请重新授权';return;}if(!r.ok){interval=Math.min(interval+5,60);continue;}f.phase='failed';f.url='';f.message='Lark 授权失败，请重新发起';return;}catch{if(f.controller.signal.aborted)return;interval=Math.min(interval+2,60);}
  }if(!f.controller.signal.aborted){f.phase='expired';f.url='';f.message='授权链接已过期，请重新发起';}
 }
 async cancel(user:string){const f=this.flows.get(user);f?.controller.abort();this.flows.delete(user);return {ok:true};}
 async disconnect(user:string){await this.cancel(user);await this.db.q('DELETE FROM pm_settings WHERE name=?',['lark-user-'+user]);return {ok:true};}
}
