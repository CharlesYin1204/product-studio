import { Injectable, OnModuleInit } from '@nestjs/common';
import mysql, { PoolConnection } from 'mysql2/promise';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { hash } from 'bcryptjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
export const uid = () => randomUUID();
@Injectable()
export class Db implements OnModuleInit {
  pool = mysql.createPool({ host:process.env.DB_HOST, port:Number(process.env.DB_PORT||3306), user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:10,charset:'utf8mb4',timezone:'Z',dateStrings:true });
  constructor(){this.pool.on('connection',connection=>{connection.query("SET time_zone = '+00:00'");});}
  async q(sql:string,args:any[]=[]):Promise<any[]> { const [r]=await this.pool.execute(sql,args); return r as any[]; }
  async one(sql:string,args:any[]=[]):Promise<any> { return (await this.q(sql,args))[0]; }
  async tx<T>(fn:(c:PoolConnection)=>Promise<T>):Promise<T> { const c=await this.pool.getConnection(); await c.beginTransaction(); try {const r=await fn(c);await c.commit();return r;}catch(e){await c.rollback();throw e;}finally{c.release();} }
  async onModuleInit(){
    const sql=readFileSync('server/schema.sql','utf8');
    for(const stmt of sql.split(';').filter(s=>s.trim())) await this.q(stmt);
    if(!(await this.one("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pm_shares' AND COLUMN_NAME='password_hash'")))await this.q('ALTER TABLE pm_shares ADD COLUMN password_hash VARCHAR(100) NULL');
    await this.q('DELETE FROM pm_share_sessions WHERE expires_at<NOW()');
    if(process.env.CODEX_CLI_ENABLED==='true' && existsSync(process.env.CODEX_CLI_PATH||'/usr/local/bin/product-studio-codex') && existsSync(`${process.env.CODEX_HOME||'/var/lib/product-studio-codex'}/auth.json`)){
      const codex=await this.one("SELECT id FROM pm_models WHERE base_url='codex://local' LIMIT 1");
      if(!codex)await this.q('INSERT INTO pm_models(id,name,base_url,model,api_key) VALUES(?,?,?,?,?)',[uid(),'Codex · 服务器本机','codex://local',process.env.CODEX_MODEL||'gpt-6-astra',this.encrypt('codex-local')]);
    }
    await this.q("UPDATE pm_messages SET status='failed' WHERE status='pending'");
    if(!(await this.one('SELECT id FROM pm_users LIMIT 1'))){
      const id=uid(),password=process.env.ADMIN_PASSWORD||randomBytes(18).toString('base64url');
      await this.q('INSERT INTO pm_users(id,email,name,password,admin) VALUES(?,?,?,?,1)',[id,process.env.ADMIN_EMAIL||'admin@product.local','产品负责人',await hash(password,12)]);
      writeFileSync('.access-admin',`账号：${process.env.ADMIN_EMAIL||'admin@product.local'}\n密码：${password}\n`,{mode:0o600});
      const p=uid();
      const instruction=readFileSync('产品设计需求文档/instruction.md','utf8');
      await this.tx(async c=>{
        await c.execute('INSERT INTO pm_projects(id,name,description,owner_id) VALUES(?,?,?,?)',[p,'AI 产品经理工具','从产品需求出发，连接原型设计、团队评审与研发交付。',id]);
        await c.execute('INSERT INTO pm_members(project_id,user_id,role) VALUES(?,?,?)',[p,id,'owner']);
        const add=async(kind:string,title:string,body:any)=>{const item=uid();await c.execute('INSERT INTO pm_items(id,project_id,kind,title,body,created_by) VALUES(?,?,?,?,?,?)',[item,p,kind,title,JSON.stringify(body),id]);await c.execute('INSERT INTO pm_revisions(id,item_id,version,title,body,actor_id) VALUES(?,?,1,?,?,?)',[uid(),item,title,JSON.stringify(body),id]);};
        await add('document','产品总体需求 · instruction V1.0.1',{type:'prd',content:instruction,source:'产品设计需求文档/instruction.md'});
        const lines=instruction.split('\n').filter(l=>/^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+[，,.]/.test(l));
        for(const [index,line] of lines.entries()) await add('requirement',line.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+[，,.]/,'').trim().slice(0,180),{description:line,status:'backlog',priority:index<3?'high':'medium',module:'',release:'',dueDate:'',assignee:'',source:'instruction V1.0.1'});
        await c.execute('INSERT INTO pm_activity(id,project_id,actor_id,action) VALUES(?,?,?,?)',[uid(),p,id,'导入 instruction V1.0.1 原始需求文档']);
      });
    }
  }
  encrypt(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(process.env.ENCRYPTION_KEY!,'hex'),iv);const out=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),out]).toString('base64');}
  decrypt(value:string){const b=Buffer.from(value,'base64');const d=createDecipheriv('aes-256-gcm',Buffer.from(process.env.ENCRYPTION_KEY!,'hex'),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}
  async setting(key:string){const r=await this.one('SELECT value FROM pm_settings WHERE name=?',[key]);return r?JSON.parse(this.decrypt(r.value)):{};}
  async putSetting(key:string,value:any){await this.q('INSERT INTO pm_settings(name,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',[key,this.encrypt(JSON.stringify(value))]);}
}
