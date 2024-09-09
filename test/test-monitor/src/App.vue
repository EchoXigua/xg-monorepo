<template>
  <div></div>
  <img src="/vite.svg" class="logo" alt="Vite logo" />
  <HelloWorld msg="Vite + Vue" />

  <router-link to="/">home</router-link> <span> </span>
  <router-link to="/about">about</router-link>
  <router-view></router-view>
</template>

<script setup lang="ts">
import HelloWorld from '@/components/HelloWorld.vue';
</script>

<style lang="scss" scoped></style>
