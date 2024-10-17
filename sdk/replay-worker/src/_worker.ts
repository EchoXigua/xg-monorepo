import { handleMessage } from './handleMessage';

/**
 * 这里是真正的web worker 处理消息和发送消息的地方
 */

addEventListener('message', handleMessage);

// Immediately send a message when worker loads, so we know the worker is ready
postMessage({
  id: undefined,
  method: 'init',
  success: true,
  response: undefined,
});
