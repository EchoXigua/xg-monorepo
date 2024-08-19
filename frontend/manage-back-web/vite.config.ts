import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: '/xg-monorepo/manage/',
  plugins: [vue()],
  server: {
    open: true,
  },
});
