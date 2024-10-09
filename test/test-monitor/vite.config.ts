import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import vue from '@vitejs/plugin-vue';
import baseConfig from '../../vite/vite.config';

// https://vitejs.dev/config/
export default defineConfig({
  ...baseConfig,
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // entryFileNames: 'js/[name]-[hash].js', // JS 文件名格式
        // chunkFileNames: 'js/[name]-[hash].js',
        // assetFileNames: 'js/[name]-[hash].[ext]', // 确保所有文件名和路径一致
        // sourcemapBaseUrl: 'http://localhost:4173/js/',
      },
    },
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    sentryVitePlugin({
      org: 'xg-p6',
      project: 'test-vue3',
    }),
  ],
});
