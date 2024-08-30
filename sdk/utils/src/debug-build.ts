// 这个常量通常在构建时由构建工具（如 Webpack、Rollup 等）注入，表示当前构建是否为调试版本
declare const __DEBUG_BUILD__: boolean;

/**
 * 在开发和调试构建中，__DEBUG_BUILD__ 的值通常为 true，而在生产构建中通常为 false
 *
 *
 * 注释中提到这个常量绝对不应跨越包边界（即不应导出）。这个的意思是只在utils 这个包内部使用，其他包不要去使用
 * 这主要是为了确保可以进行树摇（tree shaking）， 即在生产构建中自动去除未使用的代码。
 * 如果这个常量被导出并在其他包中使用，构建工具可能无法正确识别它未被使用，从而导致调试代码在生产版本中也被包含，影响性能和安全性。
 *
 */
export const DEBUG_BUILD = __DEBUG_BUILD__;
