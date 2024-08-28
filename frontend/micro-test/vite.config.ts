import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      vue(),
      qiankun(env.VITE_PKG_NAME, {
        useDevMode: true,
      }),
    ],
    server: {
      port: 7002,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
  };
});
