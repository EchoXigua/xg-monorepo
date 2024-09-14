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
        entryFileNames: 'js/[name]-[hash].js', // JS 文件名格式
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: 'js/[name]-[hash].[ext]', // 确保所有文件名和路径一致
        sourcemapBaseUrl: 'http://localhost:4173/js/',
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
      debug: true,
      org: 'xigua',
      project: 'test',
      url: 'http://localhost:9000/',
      // release: {
      //   name: 'test-vue@1.0.2',
      // },
      sourcemaps: {
        // assets: ['./dist/assets/*.js.map'],
        // filesToDeleteAfterUpload: ['dist/**/*.js.map'],
      },
      authToken:
        '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',
    }),
  ],
});
