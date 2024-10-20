import { handleMessage } from './handleMessage';

/**
 * 这里是真正的web worker 处理消息和发送消息的地方
 */

addEventListener('message', handleMessage);

// 当worker加载时立即发送一个消息，这样我们就知道worker已经准备好了
postMessage({
  id: undefined,
  method: 'init',
  success: true,
  response: undefined,
});
