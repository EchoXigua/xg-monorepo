import type { Package } from './package';

export interface SdkInfo {
  // SDK 的名称，表示使用的 SDK 的类型或名称（例如 sentry.javascript.browser）
  name?: string;
  // SDK 的版本号，表示当前使用的 SDK 的版本（例如 1.0.0）
  version?: string;
  // 该 SDK 集成的其他库或工具（例如 @xigua-monitor/integrations）
  integrations?: string[];
  // 包含 SDK 使用的所有依赖包的详细信息
  packages?: Package[];
}
