import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Db,uid } from './db';
import { Workspace } from './workspace';
import { renderPrototype } from './prototype';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { z } from 'zod';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
export async function publicUrl(value:string){
 let u:URL;try{u=new URL(value);}catch{throw new BadRequestException('请输入正确的 HTTPS API 地址');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new BadRequestException('API 地址必须是无凭据的 HTTPS 地址');
 const ips=await lookup(u.hostname,{all:true}).catch(()=>[]);
 if(!ips.length||ips.some(a=>a.family!==4||/^(127\.|10\.|192\.168\.|169\.254\.|0\.|224\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)))throw new BadRequestException('API 地址必须解析到公网 IPv4 地址');
 return value.replace(/\/$/,'');
}
async function jsonFetch(url:string,init:any={}){const r=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok)throw new BadRequestException(`外部服务返回 HTTP ${r.status}，请检查配置和权限`);const d:any=await r.json();return d;}
@Injectable()
export class Integrations{
 private generations=new Map<string,{controller:AbortController;saving:boolean}>();
 async pause(project:string,user:string,id:string){
  await this.ws.access(project,user,'edit');z.string().uuid().parse(id);
  const job=this.generations.get(`${project}:${user}:${id}`);
  if(!job)throw new ConflictException('任务尚未开始或已经结束，请稍后查看生成状态');
  if(job.saving)throw new ConflictException('内容已生成，正在保存，请稍候');
  job.controller.abort();return {paused:true};
 }
 constructor(private db:Db,private ws:Workspace){}
 async ai(modelId:string,messages:any[],signal?:AbortSignal){const m=await this.db.one('SELECT * FROM pm_models WHERE id=?',[modelId]);if(!m)throw new BadRequestException('请先在设置中添加 AI 模型');if(m.base_url==='codex://local')return this.codex(messages, m.model, signal);await publicUrl(m.base_url);const d=await this.aiRequest(`${m.base_url}/chat/completions`,{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.db.decrypt(m.api_key)}`},body:JSON.stringify({model:m.model,messages,stream:false})});if(d.choices?.[0]?.finish_reason==='length')throw new BadRequestException('模型输出达到长度限制，内容尚未完整；请缩小生成范围后重试');const text=d.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw new BadRequestException('模型未返回有效内容');return text;}
 async codex(messages:any[],model:string,signal?:AbortSignal){
  const cli=process.env.CODEX_CLI_PATH||'/usr/local/bin/product-studio-codex';
  const home=process.env.CODEX_HOME||'/var/lib/product-studio-codex';
  if(!existsSync(cli)||!existsSync(`${home}/auth.json`))throw new BadRequestException('服务器 Codex 未完成认证，请联系管理员配置 Codex CLI');
  const prompt=messages.map(m=>`${m.role.toUpperCase()}:\n${m.content}`).join('\n\n')+'\n\n请直接输出最终内容，不要解释调用过程，不要执行任何文件修改或命令。';
  return await new Promise<string>((resolve,reject)=>{
   const child=spawn(cli,['exec','--json','--skip-git-repo-check','--ephemeral','-s','read-only','-m',model,'-'],{cwd:'/tmp',env:{...process.env,CODEX_HOME:home,HOME:'/var/lib/product-studio-codex'},stdio:['pipe','pipe','pipe']});
   let out='',err='',done=false;const finish=(fn:any,value:any)=>{if(done)return;done=true;fn(value);};
   const timeout=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),2000);finish(reject,new BadRequestException('Codex 生成超时，请缩小内容范围后重试；输入已保留'));},Number(process.env.CODEX_TIMEOUT_MS||300000));
   const abort=()=>{child.kill('SIGTERM');finish(resolve,{__paused:true});};if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
   child.stdout.on('data',d=>{out+=d.toString();});child.stderr.on('data',d=>{err+=d.toString();});
   child.on('error',e=>{clearTimeout(timeout);finish(reject,new BadRequestException('Codex CLI 启动失败，请检查服务器安装与认证'))});
   child.on('close',(code)=>{clearTimeout(timeout);if(done)return;try{let text='';for(const line of out.split(/\r?\n/)){if(!line.trim())continue;const e=JSON.parse(line);if(e.type==='item.completed'&&e.item?.type==='agent_message')text+=e.item.text||'';}if(code!==0||!text.trim())throw new Error(err.slice(-500)||`exit ${code}`);finish(resolve,text.trim());}catch(e:any){finish(reject,new BadRequestException(`Codex 生成失败：${String(e.message).slice(0,500)}`));}});
   child.stdin.end(prompt);
  });
 }
 async aiRequest(url:string,init:any){
  const configured=Number(process.env.AI_TIMEOUT_MS||300000);
  const timeout=Number.isFinite(configured)&&configured>=1000?Math.min(configured,300000):300000;
  try{
   const r=await fetch(url,{...init,redirect:'error',signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
   if(!r.ok){const hints:Record<number,string>={401:'模型密钥无效，请更新 API Key',403:'模型服务拒绝访问，请检查账号权限',429:'模型服务限流或额度不足，请稍后重试或检查额度'};throw new BadRequestException(hints[r.status]||`模型服务返回 HTTP ${r.status}，请稍后重试`);}
   try{return await r.json();}catch(e:any){if(e.name==='TimeoutError'||e.name==='AbortError')throw e;throw new BadRequestException('模型服务返回格式无效，请检查是否为 Chat Completions 兼容接口');}
  }catch(e:any){
   if(e instanceof BadRequestException)throw e;
   if(e.name==='TimeoutError'||e.name==='AbortError')throw new BadRequestException(`模型生成超过 ${Math.round(timeout/1000)} 秒，已停止等待；请缩小本次生成范围后重试，输入已保留`);
   throw new BadRequestException('连接模型服务失败或连接中断，请稍后重试；输入已保留');
  }
 }
 async generate(project:string,user:string,input:any){
  await this.ws.access(project,user,'edit');
  const b=z.object({requestId:z.string().uuid().optional(),modelId:z.string().uuid(),prompt:z.string().trim().min(1).max(20000),itemId:z.string().uuid().optional(),kind:z.enum(['chat','prd','technical','note','prototype']),language:z.enum(['html','vue','react']).default('html'),surface:z.enum(['frontend','admin']).default('frontend'),multiAgent:z.boolean().default(false)}).parse(input);
  const mid=uid();
  const key=`${project}:${user}:${b.requestId||mid}`,job={controller:new AbortController(),saving:false};
  if(this.generations.has(key))throw new ConflictException('此生成请求已在执行');
  this.generations.set(key,job);
  const signal=job.controller.signal;
  const generateAI=async(messages:any[])=>{signal.throwIfAborted();const value=await this.ai(b.modelId,messages,signal);signal.throwIfAborted();return value;};
  try{
  const model=await this.db.one('SELECT id FROM pm_models WHERE id=?',[b.modelId]);if(!model)throw new BadRequestException('请先配置可用的 AI 模型');
  const target=b.itemId?await this.ws.item(b.itemId,user):null;if(target&&target.project_id!==project)throw new BadRequestException('关联内容不属于此项目');
  const p=await this.db.one('SELECT name,description FROM pm_projects WHERE id=?',[project]);
  const reqs=await this.db.q('SELECT id,title,body FROM pm_items WHERE project_id=? AND kind=? ORDER BY updated_at DESC LIMIT 100',[project,'requirement']);
  const history=await this.db.q('SELECT role,content FROM pm_messages WHERE project_id=? AND user_id=? AND item_id <=> ? AND status=? ORDER BY created_at DESC LIMIT 12',[project,user,b.itemId||null,'complete']);
  await this.db.q('INSERT INTO pm_messages(id,project_id,item_id,user_id,role,content,status) VALUES(?,?,?,?,?,?,?)',[mid,project,b.itemId||null,user,'user',b.prompt,'pending']);
  const log=async(content:string,agent:string)=>{await this.db.q('INSERT INTO pm_messages(id,project_id,item_id,user_id,role,agent,content) VALUES(?,?,?,?,?,?,?)',[uid(),project,b.itemId||null,user,'assistant',agent,content]);};
   const context=`你是严谨的产品经理。基于真实需求工作，不编造业务数据。项目：${JSON.stringify(p)}。需求：${JSON.stringify(reqs).slice(0,60000)}。当前关联内容：${JSON.stringify(target).slice(0,80000)}。`;
   let review='';
   if(b.multiAgent){const plan=await generateAI([{role:'system',content:context+'你是需求分析 Agent，给出目标、流程、边界与验收标准。'},{role:'user',content:b.prompt}]);await log(plan,'需求分析 Agent');review=await generateAI([{role:'system',content:'你是技术评审 Agent，审查下面的需求方案并给出实现约束与遗漏。'},{role:'user',content:plan}]);await log(review,'技术评审 Agent');}
   const instruction=b.kind==='prototype'?`输出可运行的 ${b.language} ${b.surface==='admin'?'后台管理':'前台用户界面'}原型源码，不要解释，不要 Markdown 围栏。html 为完整 HTML，vue 为带 script setup 的 SFC，react 为默认导出的 App 组件。仅允许导入 vue、react、react-dom。样式内联，不使用 CDN。真实数据通过 await window.pmData('list','集合名') 读取，返回 [{id,data}]；通过 pmData('create','集合名',对象)、pmData('update','集合名',对象,id)、pmData('delete','集合名',null,id) 写入 MySQL。初始为空，不使用假数据。不要执行网络请求。`:
    b.kind==='note'?'输出结构化 Markdown 产品笔记，包含背景、讨论结论、决策记录、行动项、待确认问题；仅引用已知事实。':b.kind==='technical'?'输出 Markdown 技术文档，包含架构、API 路由与请求响应、MySQL 字段表、校验、权限、异常、验收。':b.kind==='prd'?'输出标准 Markdown PRD：版本信息、背景与目标、用户角色、范围、流程、功能需求、字段规则、权限、异常状态、非功能要求、验收标准、待确认项。':'回答用户问题，给出具体产品建议。';
   const content=await generateAI([{role:'system',content:context+instruction+(review?'\n评审建议：'+review:'')},...history.reverse().map(h=>({role:h.role,content:h.content})),{role:'user',content:b.prompt}]);
   await log(content,b.multiAgent?'交付 Agent':'产品助手');
   let item=null;
   if(b.kind!=='chat'){
    const kind=b.kind==='prototype'?'prototype':'document';const source=content.replace(/^```[^\n]*\n/,'').replace(/\n```\s*$/,'');
    if(kind==='prototype')await renderPrototype(source,b.language);
    const compatible=target?.kind===kind;
    const body=kind==='prototype'?{...(compatible?target.body:{}),language:b.language,surface:b.surface,source,requirementId:target?.kind==='requirement'?target.id:(target?.body.requirementId||'')}:{...(compatible?target.body:{}),type:b.kind,content,requirementId:target?.kind==='requirement'?target.id:(target?.body.requirementId||'')};
    signal.throwIfAborted();job.saving=true;
    item=await this.ws.save(project,user,{kind,title:compatible?target.title:`${b.kind==='prototype'?'原型':b.kind==='prd'?'需求文档':b.kind==='note'?'产品笔记':'技术文档'} · ${b.prompt.slice(0,70)}`,body,version:compatible?target.version:undefined},compatible?target.id:undefined);
   }
   signal.throwIfAborted();job.saving=true;
   await this.db.q('UPDATE pm_messages SET status=? WHERE id=?',['complete',mid]);return {item,content};
  }catch(e:any){if(signal.aborted){await this.db.q('UPDATE pm_messages SET status=? WHERE id=?',['paused',mid]);return {paused:true};}console.error('[AI generation failed]',JSON.stringify({messageId:mid,modelId:b.modelId,kind:b.kind,errorType:e.name,code:e.code||null}));await this.db.q('UPDATE pm_messages SET status=? WHERE id=?',['failed',mid]);throw new BadRequestException(e.response?.message||'AI 生成失败，请检查模型配置后重试；输入已保留');}finally{this.generations.delete(key);}
 }
 async notify(event:string,title:string,project:string){
  const config=await this.db.setting('telegram');if(!config.enabled||!config.token||!config.chatIds||!config.events?.includes(event))return;
  const p=await this.db.one('SELECT name FROM pm_projects WHERE id=?',[project]);
  const text=(config.template||'{project} · {event}\n{title}').replaceAll('{project}',p.name).replaceAll('{event}',event==='requirement'?'新需求':'评审意见').replaceAll('{title}',title).slice(0,4096);
  for(const chat_id of config.chatIds.split(/[\n,]/).map((x:string)=>x.trim()).filter(Boolean)){
   try{const d=await jsonFetch(`https://api.telegram.org/bot${config.token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id,text})});if(!d.ok)throw new Error();await this.db.q('INSERT INTO pm_notifications(id,event,status,detail) VALUES(?,?,?,?)',[uid(),event,'sent','通知已送达']);}catch{await this.db.q('INSERT INTO pm_notifications(id,event,status,detail) VALUES(?,?,?,?)',[uid(),event,'failed','发送失败，请检查 Bot Token、Chat ID 和群权限']);}
  }
 }
 async larkToken(user:string){const c=await this.db.setting(`lark-user-${user}`);if(!c.access_token)throw new BadRequestException('请先授权绑定 Lark 国际版');if(c.expiresAt>Date.now()+60000)return c.access_token;if(!c.refresh_token)throw new BadRequestException('Lark 授权已过期，请重新绑定');const own=await this.db.setting('lark-app-'+user);const app=own.appId?own:await this.db.setting('lark');const d=await jsonFetch('https://open.larksuite.com/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:app.appId,client_secret:app.appSecret,refresh_token:c.refresh_token})});if(d.code!==0||!d.access_token)throw new BadRequestException('Lark 授权已过期，请重新绑定');await this.db.putSetting(`lark-user-${user}`,{...d,expiresAt:Date.now()+d.expires_in*1000});return d.access_token;}
 async lark(user:string,path:string,method='GET',body?:any){const token=await this.larkToken(user);const d=await jsonFetch('https://open.larksuite.com/open-apis/'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(d.code!==0)throw new BadRequestException('Lark 操作失败：'+String(d.msg||d.code).slice(0,200));return d.data;}
 async oauth(user:string,code:string){const c=await this.db.setting('lark');const d=await jsonFetch('https://open.larksuite.com/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:c.appId,client_secret:c.appSecret,code,redirect_uri:process.env.PUBLIC_URL+'/api/auth/lark/callback'})});if(d.code!==0||!d.access_token)throw new BadRequestException('Lark 授权失败，请核对应用与回调地址');await this.db.putSetting(`lark-user-${user}`,{...d,expiresAt:Date.now()+d.expires_in*1000});}
}
