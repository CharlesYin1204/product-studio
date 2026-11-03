import { BadRequestException } from '@nestjs/common';
import { parse, compileScript } from '@vue/compiler-sfc';
import { build } from 'esbuild';
export const bridge=`<script>(()=>{let n=0;const pending=new Map();window.pmData=(action,collection,data,id)=>new Promise((resolve,reject)=>{const requestId=String(++n);const t=setTimeout(()=>{pending.delete(requestId);reject(new Error('数据请求超时'))},15000);pending.set(requestId,{resolve,reject,t});parent.postMessage({type:'pm-data',requestId,action,collection,data,id},'*')});addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='pm-data-result')return;const p=pending.get(e.data.requestId);if(p){clearTimeout(p.t);pending.delete(e.data.requestId);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data.result)}})})()</script>`;
export async function renderPrototype(source:string,language:string){
 let html=source;
 if(language!=='html'){
  let code=source;
  let css='';
  if(language==='vue'){const {descriptor,errors}=parse(source);if(errors.length)throw new BadRequestException('Vue 文件解析失败：'+String(errors[0]));try{code=compileScript(descriptor,{id:'prototype',inlineTemplate:true}).content;css=descriptor.styles.map(s=>s.content).join('\n');}catch(e:any){throw new BadRequestException('Vue 编译失败：'+e.message);}}
  try{const result=await build({stdin:{contents:language==='vue'?`import {createApp} from 'vue';import App from 'prototype-source';createApp(App).mount('#app');`:`import React from 'react';import {createRoot} from 'react-dom/client';import App from 'prototype-source';createRoot(document.getElementById('app')).render(React.createElement(App));`,resolveDir:process.cwd(),loader:'js'},plugins:[{name:'prototype-source',setup(b){b.onResolve({filter:/^prototype-source$/},()=>({path:'prototype-source',namespace:'generated'}));b.onLoad({filter:/.*/,namespace:'generated'},()=>({contents:code,loader:language==='vue'?'ts':'tsx',resolveDir:process.cwd()}));b.onResolve({filter:/.*/},args=>{if(args.path==='prototype-source'||['vue','react','react-dom/client','react/jsx-runtime'].includes(args.path)||args.importer.includes('node_modules'))return;return {errors:[{text:'仅支持 Vue / React 内置依赖，请将其他资源内联'}]};});}}],bundle:true,write:false,format:'iife',minify:true,define:{'process.env.NODE_ENV':'"production"'}});html=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui}${css}</style></head><body><div id="app"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;}catch(e:any){throw new BadRequestException('原型编译失败，请检查源码：'+String(e.message).slice(0,600));}
 }
 const policy=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
 return policy+bridge+html;
}
