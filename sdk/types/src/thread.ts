import type { Stacktrace } from './stacktrace';

/** 用于描述在应用程序中捕获的线程信息，特别是在发生错误或异常时 */
export interface Thread {
  // 线程的唯一标识符，表示当前线程的 ID,可能在某些情况下缺失
  id?: number;
  // 线程的名称，表示该线程的描述或标识性名称。这个属性也是可选的，可能在某些环境中无法获取
  name?: string;
  // 关联的堆栈跟踪信息,这个属性用来记录该线程在异常发生时的堆栈信息，便于后续的调试和错误分析
  stacktrace?: Stacktrace;
  // 指示线程是否已经崩溃
  crashed?: boolean;
  // 表示该线程是否是当前活动线程
  current?: boolean;
}
