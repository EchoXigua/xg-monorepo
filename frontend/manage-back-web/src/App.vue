<template>
  <div>App</div>
  <Test></Test>
  <router-link to="/">home</router-link> &nbsp;
  <router-link to="/about">about</router-link>
  <router-view></router-view>
</template>

<script setup lang="ts">
import { Test } from '@xigua/components';
import { sum } from '@xigua/utils';
console.log(sum(1, 2));
</script>

<style lang="scss" scoped></style>
