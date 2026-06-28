/**
 * [debug-loop] Event Blackbox - 全量事件记录器
 *
 * 自动记录终端页面所有关键状态变化，用于远程调试。
 * 所有事件带时间戳，存储为环形缓冲区（最多500条）。
 *
 * 使用方式：
 *   import { blackbox } from './utils/eventLogger';
 *   blackbox.log('category', 'event', { data });
 *
 * 导出方式（在手机浏览器控制台或地址栏执行）：
 *   javascript:alert(JSON.stringify(window.__blackbox.export()))
 * 或通过 debug 面板的"导出"按钮。
 */

interface BlackboxEvent {
  t: number;       // 相对时间戳（ms，从首次 log 开始）
  abs: number;     // 绝对时间戳
  cat: string;     // 类别：viewport | terminal | ws | navigation | fit | raf
  event: string;   // 事件名
  data?: Record<string, unknown>; // 附加数据
}

const MAX_EVENTS = 500;

// Debug mode: enabled by URL param ?debug or localStorage 'blackbox-enabled'
const ENABLED = typeof window !== 'undefined' && (
  new URLSearchParams(window.location.search).has('debug') ||
  localStorage.getItem('blackbox-enabled') === 'true'
);

class EventBlackbox {
  private events: BlackboxEvent[] = [];
  private startTime: number | null = null;
  private listeners: Array<() => void> = [];

  /** Whether blackbox recording is enabled */
  get enabled(): boolean { return ENABLED; }

  log(cat: string, event: string, data?: Record<string, unknown>) {
    if (!ENABLED) return; // Zero overhead when disabled
    if (this.startTime === null) this.startTime = Date.now();

    const entry: BlackboxEvent = {
      t: Date.now() - this.startTime,
      abs: Date.now(),
      cat,
      event,
      data,
    };

    this.events.push(entry);

    // Ring buffer: remove oldest when exceeding max
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    // Notify listeners (for real-time debug panel)
    for (const listener of this.listeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  export(): { events: BlackboxEvent[]; startTime: number; exportedAt: number } {
    return {
      events: [...this.events],
      startTime: this.startTime || 0,
      exportedAt: Date.now(),
    };
  }

  exportJSON(): string {
    return JSON.stringify(this.export(), null, 2);
  }

  clear() {
    this.events = [];
    this.startTime = null;
  }

  count(): number {
    return this.events.length;
  }

  last(): BlackboxEvent | null {
    return this.events[this.events.length - 1] || null;
  }

  // Subscribe to new events (for debug panel real-time display)
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Get recent events for debug panel display
  recent(count: number = 10): BlackboxEvent[] {
    return this.events.slice(-count);
  }
}

// Singleton
export const blackbox = new EventBlackbox();

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).__blackbox = blackbox;
}
