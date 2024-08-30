<template>
  <div>hello world</div>
</template>

<script setup lang="ts">
import { getCurrentInstance } from 'vue';
const instance = getCurrentInstance();
console.log(instance);
</script>

<style lang="scss" scoped></style>
