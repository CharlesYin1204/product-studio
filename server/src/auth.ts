import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Db } from './db';
import { createHash } from 'crypto';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
@Injectable()
export class AuthGuard implements CanActivate{
 constructor(private db:Db){}
 async canActivate(ctx:ExecutionContext){const r=ctx.switchToHttp().getRequest();const token=r.cookies?.pm_session;if(!token)throw new UnauthorizedException('请先登录');const u=await this.db.one('SELECT u.id,u.name,u.email,u.admin FROM pm_sessions s JOIN pm_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>NOW()',[digest(token)]);if(!u)throw new UnauthorizedException('登录已过期，请重新登录');r.user=u;return true;}
}
export function admin(r:any){if(!r.user.admin)throw new ForbiddenException('仅管理员可以修改此配置');}
