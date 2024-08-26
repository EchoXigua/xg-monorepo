import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    qiankun('micro-demo', {
      useDevMode: true,
    }),
  ],
  server: {
    port: 7002,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
});
