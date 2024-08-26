<template>
  <div></div>
  <img src="/vite.svg" class="logo" alt="Vite logo" />
  <HelloWorld msg="Vite + Vue" />
  <div>micro demo container</div>
  <router-link to="/">micro home</router-link>
  <router-link to="/about">micro about</router-link>
  <router-view></router-view>
</template>

<script setup lang="ts">
import HelloWorld from '@/components/HelloWorld.vue';
</script>

<style lang="scss" scoped></style>
