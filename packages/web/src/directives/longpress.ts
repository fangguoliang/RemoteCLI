// packages/web/src/directives/longpress.ts
import type { Directive } from 'vue';

export const vLongpress: Directive = {
  mounted(el, binding) {
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    const LONG_PRESS_MS = 500;

    const start = (e: Event) => {
      pressTimer = setTimeout(() => {
        binding.value(e);
      }, LONG_PRESS_MS);
    };

    const cancel = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    // Mouse events (desktop)
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);

    // Touch events (mobile)
    el.addEventListener('touchstart', start);
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);

    // Store cleanup function
    (el as any)._longpressCleanup = () => {
      el.removeEventListener('mousedown', start);
      el.removeEventListener('mouseup', cancel);
      el.removeEventListener('mouseleave', cancel);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchend', cancel);
      el.removeEventListener('touchcancel', cancel);
    };
  },
  unmounted(el) {
    (el as any)._longpressCleanup?.();
  },
};
