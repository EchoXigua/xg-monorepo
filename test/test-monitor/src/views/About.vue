<template>
  <div>about pages</div>
  <button @click="handleErr">抛出异常</button>
</template>

<script setup lang="ts">
const handleErr = () => {
  Promise.reject('test promise');
  // throw new Error('sentry test');
};
</script>

<style lang="scss" scoped></style>
