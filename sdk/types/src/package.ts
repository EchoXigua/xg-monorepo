/** package.json 中的字段 */
export interface Package {
  // 依赖包的名称
  name: string;
  // 依赖包的版本号
  version: string;
  // 运行依赖
  dependencies?: Record<string, string>;
  // 开发依赖
  devDependencies?: Record<string, string>;
}
