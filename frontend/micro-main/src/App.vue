<template>
  <div></div>
  <img src="/vite.svg" class="logo" alt="Vite logo" />
  <HelloWorld msg="Vite + Vue" />
  <router-link to="/">main home</router-link> &nbsp;
  <router-link to="/about">main about</router-link>

  <div>
    <router-link to="/test-demo">test-demo</router-link> &nbsp;
    <router-link to="/micro-demo">micro-demo</router-link>
  </div>

  router view ~~~~~
  <router-view></router-view>
</template>

<script setup lang="ts">
import HelloWorld from '@/components/HelloWorld.vue';
</script>

<style lang="scss" scoped></style>
