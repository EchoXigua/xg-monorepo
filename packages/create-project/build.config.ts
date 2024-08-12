import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  entries: ['src/index'],
  clean: true,
  rollup: {
    // 将所有的依赖模块内联到最终的构建输出中
    inlineDependencies: true,
    esbuild: {
      target: 'node18',
      // 对代码进行压缩
      minify: true,
    },
  },
  alias: {
    prompts: 'prompts/lib/index.js',
  },
});
