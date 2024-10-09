import { createApp } from 'vue';
import App from './App.vue';
// import * as Sentry from '@sentry/vue';
import * as Sentry from '@xigua-monitor/vue';
import router from './router';

const app = createApp(App);
console.log('app', app);

Sentry.init({
  app,
  // dsn: 'http://f70471da81fe3b1c5625e364f3aee1ef@localhost:9000/4',
  dsn: 'https://2a24260c8f23af4db99f7f8af2947653@o4507849254699008.ingest.us.sentry.io/4507921663590400',
  integrations: [
    Sentry.browserTracingIntegration({ router }),
    // Sentry.replayIntegration(),
  ],
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
  // tracePropagationTargets: ['localhost', /^https:\/\/yourserver\.io\/api/],
  tracePropagationTargets: [],
  // Session Replay
  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
});

app.use(router);
app.mount('#app');
