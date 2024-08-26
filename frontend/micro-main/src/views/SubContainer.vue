<template>
  <div>子应用容器</div>
  <div id="sub-container"></div>
</template>

<script setup lang="ts">
import start from '@/micro';
if (!window.qiankunStarted) {
  window.qiankunStarted = true;
  start({
    sandbox: {
      experimentalStyleIsolation: true, // 样式隔离
    },
  });
}
</script>

<style lang="scss" scoped></style>
