export default [
  {
    name: 'test-demo', // 子应用名称，跟package.json一致
    entry: '//localhost:7001', // 子应用入口，本地环境下指定端口
    container: '#sub-container', // 挂载子应用的dom
    activeRule: '/test-demo', // 路由匹配规则
    props: {}, // 主应用与子应用通信传值
  },
  {
    name: 'micro-demo',
    entry: '//localhost:7002',
    container: '#sub-container',
    activeRule: '/micro-demo',
    props: {},
  },
];
