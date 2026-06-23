<template>
  <router-view />
  <VoiceFloatingBar />
</template>

<script setup lang="ts">
import VoiceFloatingBar from './components/VoiceFloatingBar.vue';
</script>

<style>
/* Disable pull-to-refresh globally */
html, body {
  overscroll-behavior-y: contain;
}
</style>