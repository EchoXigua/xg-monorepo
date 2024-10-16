/**
 * 这一行代码是为了在构建时替换掉，目的是在构建过程中将 Worker 的实际内容
 * （通常是 TypeScript 文件 _worker.ts 的内容）作为字符串注入
 * 这可以确保在编译时类型检查正常工作，同时提供一个占位符值
 */
export default '' as string;
