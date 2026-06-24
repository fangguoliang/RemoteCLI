<template>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="$attrs.class">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" x2="12" y1="19" y2="22"/>
    <!-- 斜线表示麦克风关闭 -->
    <line v-if="!active" x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2"/>
  </svg>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });

defineProps<{
  active?: boolean;
}>();
</script>
