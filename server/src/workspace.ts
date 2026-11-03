import { Injectable, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Db,uid } from './db';
import { z } from 'zod';
export const title=z.string().trim().min(1,'请输入标题').max(180);
const date=z.string().refine(v=>v===''||/^\d{4}-\d{2}-\d{2}$/.test(v),'日期格式应为 YYYY-MM-DD');
const bodies:any={
 requirement:z.object({description:z.string().max(50000).default(''),status:z.enum(['backlog','planned','progress','review','done']).default('backlog'),priority:z.enum(['high','medium','low']).default('medium'),module:z.string().max(100).default(''),release:z.string().max(100).default(''),assignee:z.string().max(100).default(''),dueDate:date.default(''),source:z.string().max(500).default('')}),
 document:z.object({type:z.enum(['prd','technical','note']).default('prd'),content:z.string().max(300000).default(''),source:z.string().max(500).default(''),requirementId:z.string().max(36).default(''),larkId:z.string().max(100).default('')}),
 prototype:z.object({language:z.enum(['html','vue','react']).default('html'),surface:z.enum(['frontend','admin']).default('frontend'),module:z.string().max(100).default(''),description:z.string().max(20000).default(''),source:z.string().max(300000).default(''),requirementId:z.string().max(36).default('')}),
 release:z.object({description:z.string().max(50000).default(''),status:z.enum(['planned','progress','released']).default('planned'),dueDate:date.default(''),requirementIds:z.array(z.string().uuid()).max(500).default([]),snapshot:z.array(z.any()).optional()}),
 template:z.object({language:z.enum(['html','vue','react']).default('html'),category:z.string().max(100).default('通用组件'),description:z.string().max(10000).default(''),source:z.string().max(300000).default('')})
};
export const kinds=Object.keys(bodies);
@Injectable()
export class Workspace{
 constructor(public db:Db){}
 async access(project:string,user:string,level='read'){
  const m=await this.db.one('SELECT m.role FROM pm_members m JOIN pm_projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=?',[project,user]);
  if(!m)throw new ForbiddenException('你没有此项目的访问权限');
  if(level==='edit'&&!['owner','editor'].includes(m.role))throw new ForbiddenException('此操作需要编辑权限');
  if(level==='comment'&&m.role==='viewer')throw new ForbiddenException('此操作需要评审权限');
  if(level==='owner'&&m.role!=='owner')throw new ForbiddenException('仅项目负责人可管理成员和分享');
  return m.role;
 }
 async item(id:string,user:string,level='read'){const i=await this.db.one('SELECT * FROM pm_items WHERE id=?',[id]);if(!i)throw new NotFoundException('内容不存在');await this.access(i.project_id,user,level);return i;}
 async activity(project:string,user:string,action:string){await this.db.q('INSERT INTO pm_activity(id,project_id,actor_id,action) VALUES(?,?,?,?)',[uid(),project,user,action.slice(0,300)]);}
 async save(project:string,user:string,input:any,id?:string){
  const x=z.object({kind:z.enum(['requirement','document','prototype','release','template']),title,body:z.unknown(),version:z.number().int().positive().optional()}).parse(input);
  await this.access(project,user,'edit');
  const body=bodies[x.kind].parse(x.body);
  if(body.requirementId){const r=await this.db.one('SELECT id FROM pm_items WHERE id=? AND project_id=? AND kind=?',[body.requirementId,project,'requirement']);if(!r)throw new BadRequestException('关联需求不存在于此项目');}
  if(body.requirementIds?.length){for(const rid of body.requirementIds){if(!await this.db.one('SELECT id FROM pm_items WHERE id=? AND project_id=? AND kind=?',[rid,project,'requirement']))throw new BadRequestException('版本中的需求不属于当前项目');}}
  if(x.kind==='release'&&body.status==='released'){
   body.snapshot=[];for(const rid of body.requirementIds){body.snapshot.push(await this.db.one('SELECT id,title,body,version FROM pm_items WHERE id=?',[rid]));}
  }
  const itemId=id||uid();
  await this.db.tx(async c=>{
   let version=1;
   if(id){const [rows]:any=await c.execute('SELECT * FROM pm_items WHERE id=? AND project_id=? FOR UPDATE',[id,project]);const old=rows[0];if(!old)throw new NotFoundException();if(old.kind!==x.kind)throw new BadRequestException('不能更改内容类型');if(old.version!==x.version)throw new ConflictException('内容已被其他人更新，请刷新后再保存');version=old.version+1;await c.execute('UPDATE pm_items SET title=?,body=?,version=? WHERE id=?',[x.title,JSON.stringify(body),version,id]);}
   else await c.execute('INSERT INTO pm_items(id,project_id,kind,title,body,created_by) VALUES(?,?,?,?,?,?)',[itemId,project,x.kind,x.title,JSON.stringify(body),user]);
   await c.execute('INSERT INTO pm_revisions(id,item_id,version,title,body,actor_id) VALUES(?,?,?,?,?,?)',[uid(),itemId,version,x.title,JSON.stringify(body),user]);
   await c.execute('UPDATE pm_projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?',[project]);
   await c.execute('INSERT INTO pm_activity(id,project_id,actor_id,action) VALUES(?,?,?,?)',[uid(),project,user,`${id?'更新':'创建'} · ${x.title}`]);
  });
  return this.item(itemId,user);
 }
}
