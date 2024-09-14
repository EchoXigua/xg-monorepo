import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __DEBUG_BUILD__: true,
    __SENTRY_SDK_SOURCE__: true,
  },
  // test: {
  //   globals: true,
  //   coverage: {
  //     enabled: true,
  //     reportsDirectory: './coverage',
  //   },
  //   typecheck: {
  //     tsconfig: './tsconfig.test.json',
  //   },
  // },
});
