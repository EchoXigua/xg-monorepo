// worker.js
/**
 * self 是一个全局对象，表示当前的 Worker 线程。
 * 与主线程中的 window 对象类似，self 允许 Worker 访问自己的上下文和方法
 */
// 监听来自主线程的消息
self.onmessage = (event) => {
  // 接收消息
  const message = event.data;

  // 处理消息并返回响应
  const response = `Received your message: "${message}"`;

  // 将响应发送回主线程
  self.postMessage(response);
};
