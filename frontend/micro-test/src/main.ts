import { createApp, App as VueApp } from 'vue';
import App from './App.vue';
import router from './router';

import {
  renderWithQiankun,
  qiankunWindow,
} from 'vite-plugin-qiankun/dist/helper';

let app: VueApp;

const render = () => {
  app = createApp(App);
  app.use(router).mount('#sub');
};

const initQianKun = () => {
  renderWithQiankun({
    mount(props) {
      //   const { container } = props;
      render();
    },
    bootstrap() {},
    unmount() {
      app.unmount();
    },
    update() {},
  });
};

qiankunWindow.__POWERED_BY_QIANKUN__ ? initQianKun() : render();
