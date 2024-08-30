/**
 * 用于在 Sentry 的服务端事件处理中，提供调试相关的元信息。
 * 这些信息能够帮助 Sentry 更好地解析和调试源代码、WebAssembly 模块、以及 macOS 系统中的 Mach-O 文件。
 **/
export interface DebugMeta {
  // 用于描述与调试相关的文件信息。Sentry 通过这些文件信息来匹配事件中的代码位置和调试文件
  images?: Array<DebugImage>;
}

// WebAssembly 、 sourcemap、macOS 系统中的 Mach-O
export type DebugImage = WasmDebugImage | SourceMapDebugImage | MachoDebugImage;

interface WasmDebugImage {
  type: 'wasm';
  // 唯一的标识符，用于匹配和识别调试文件
  debug_id: string;
  // 可选的代码标识符，通常用于标识代码文件的版本或变体
  code_id?: string | null;
  // WebAssembly 文件的路径或名称
  code_file: string;
  // 可选的调试文件路径，通常是与 WebAssembly 文件对应的调试信息文件
  debug_file?: string | null;
}

interface SourceMapDebugImage {
  type: 'sourcemap';
  // 源映射文件所对应的代码文件名
  code_file: string; // filename
  // 源映射文件的唯一标识符，通常是一个 UUID
  debug_id: string; // uuid
}

interface MachoDebugImage {
  type: 'macho';
  // Mach-O 文件的唯一标识符
  debug_id: string;
  // Mach-O 文件在内存中的加载地址
  image_addr: string;
  // 可选的字段，表示 Mach-O 文件的大小
  image_size?: number;
  // 可选的代码文件路径，通常指向 Mach-O 文件的源代码文件
  code_file?: string;
}
