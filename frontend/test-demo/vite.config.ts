import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

// https://vitejs.dev/config/
export default defineConfig({
  // base: '/xg-monorepo/test/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    qiankun('test-demo', {
      useDevMode: true,
    }),
  ],
  server: {
    port: 7001,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
});
