export async function api(path:string,method='GET',body?:any){
 let r:Response;
 try{r=await fetch('/api'+path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch{throw new Error('网络连接中断，内容仍保留在编辑器中，请检查连接后重新保存。');}
 if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('服务暂时不可用，内容尚未保存，请稍后重试。');
 const data=await r.json();if(!r.ok){const error:any=new Error(r.status===401?'登录已过期。请在另一个标签页重新登录，再回到此处保存。':data.message||'操作未完成，请重试');error.status=r.status;throw error;}return data;
}
export function download(item:any){window.location.href='/api/items/'+item.id+'/export';}
export const labels:any={backlog:'待规划',planned:'已规划',progress:'进行中',review:'待评审',done:'已完成',released:'已发布',high:'高优先级',medium:'中优先级',low:'低优先级',prd:'需求文档',technical:'技术文档',note:'产品笔记',frontend:'前台原型',admin:'后台原型',owner:'负责人',editor:'编辑',reviewer:'评审',viewer:'只读',active:'进行中',archived:'已归档',html:'HTML',vue:'Vue',react:'React'};
export const when=(d:string)=>d?new Date(d.replace(' ','T')+(d.endsWith('Z')?'':'Z')).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
