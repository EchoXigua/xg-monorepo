<template>
  <div>test demo project build test~~~</div>
  <div>子项目独立版本更新</div>
  <div>测试ci 版本变更到受保护分支</div>
  <div>test-demo 项目文件变更</div>
  <img src="/vite.svg" class="logo" alt="Vite logo" />
  <HelloWorld msg="Vite + Vue" />
  <router-link to="/">test home</router-link>
  <router-link to="/about1">test about</router-link>
  <hr />
  <router-view></router-view>
</template>

<script setup lang="ts">
import HelloWorld from '@/components/HelloWorld.vue';
import { onBeforeUnmount } from 'vue';

onBeforeUnmount(() => {
  console.log('卸载~~~');
});
</script>

<style lang="scss" scoped></style>
