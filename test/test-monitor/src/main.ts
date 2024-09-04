import { createApp } from 'vue';
import App from './App.vue';
import * as XgMonitor from '@xigua-monitor/vue';

const app = createApp(App);
console.log('app', app);

XgMonitor.init();

app.mount('#app');
