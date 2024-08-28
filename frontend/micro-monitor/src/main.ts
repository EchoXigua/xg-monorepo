import { createApp } from 'vue';
import App from './App.vue';
import { XGRequest } from 'xg-request';

const app = createApp(App);

app.mount('#app');

XGRequest.errorAlert = (error) => console.error(error.message);
XGRequest.handleHearder = () => ({
  headers: {
    access_token: 'abc',
  },
});
