<template>
  <div>App</div>
  <Test></Test>
</template>

<script setup lang="ts">
import { Test } from '@xigua/components';
import { sum } from '@xigua/utils'
console.log(sum(1, 2));
</script>

<style lang="scss" scoped></style>
