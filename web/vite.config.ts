import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
export default defineConfig({root:resolve(__dirname),plugins:[vue()],build:{outDir:resolve(__dirname,'dist'),emptyOutDir:true},server:{host:'127.0.0.1',port:5176,proxy:{'/api':'http://127.0.0.1:3010'}}});
