// [debug-blackbox] Auto-injected event recorder
// Remove with: Phase 7 cleanup or manually delete this file
// Version: v1.1 (circuit breaker + heartbeat + snapshot)

interface BlackboxEvent {
  t: number;       // 相对时间戳 (ms，从首次 log 开始)
  abs: number;     // 绝对时间戳
  cat: string;     // 类别：nav | ui | api | state | data | error | lifecycle | perf | viewport | terminal | ws | navigation | fit | raf
  event: string;   // 事件名
  data?: Record<string, unknown>; // 附加数据
}

const MAX_EVENTS = 500;
const HEARTBEAT_INTERVAL = 60_000; // 60 秒心跳
const SERVER_URL = ''; // Same-origin, use relative path

// Debug mode: [v1.1] Auto-enable when injected (no ?debug needed)
const ENABLED = true;

class EventBlackbox {
  private events: BlackboxEvent[] = [];
  private startTime: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];

  // [v1.1] 熔断器：5 秒内 3 次失败自动禁用
  private failCount = 0;
  private disabled = false;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_WINDOW_MS = 5000;
  private lastFailTime = 0;

  constructor() {
    if (!ENABLED) return;

    // 启动心跳上报（60 秒摘要）
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);

    // [v1.1] 崩溃抢救：beforeunload 时 sendBeacon
    window.addEventListener('beforeunload', () => {
      this.sendBeacon();
    });
  }

  /** Whether blackbox recording is enabled */
  get enabled(): boolean { return ENABLED && !this.disabled; }

  log(cat: string, event: string, data?: Record<string, unknown>) {
    if (!ENABLED || this.disabled) return; // Zero overhead when disabled or circuit-broken

    // [v1.1] 防止循环引用导致 JSON.stringify 崩溃
    let safeData: Record<string, unknown> | undefined;
    try {
      safeData = data ? JSON.parse(JSON.stringify(data)) : undefined;
    } catch {
      safeData = { error: 'circular-reference-in-data' };
    }

    if (this.startTime === null) this.startTime = Date.now();

    const entry: BlackboxEvent = {
      t: Date.now() - this.startTime,
      abs: Date.now(),
      cat,
      event,
      data: safeData,
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

  // [v1.1] 用户触发快照（点击"复现了"按钮时前端调用此方法）
  async captureSnapshot(label: string = 'bug-reproduced'): Promise<void> {
    if (!ENABLED || this.disabled) return;

    const payload = {
      events: [...this.events],
      startTime: this.startTime || 0,
      capturedAt: Date.now(),
      label,
      eventCount: this.events.length,
    };

    await this.upload(payload);
  }

  // [v1.1] 低频心跳（仅上报摘要，节省带宽）
  private async sendHeartbeat(): Promise<void> {
    if (this.disabled) return;

    const recentEvents = this.events.slice(-10);
    const payload = {
      events: recentEvents,
      startTime: this.startTime || 0,
      capturedAt: Date.now(),
      label: 'heartbeat',
      eventCount: this.events.length,
      isHeartbeat: true,
    };

    await this.upload(payload);
  }

  // [v1.1] 崩溃抢救（beforeunload 时用 sendBeacon 抢救数据）
  private sendBeacon(): void {
    if (this.disabled || this.events.length === 0) return;

    const payload = {
      events: [...this.events],
      startTime: this.startTime || 0,
      capturedAt: Date.now(),
      label: 'before-unload',
      eventCount: this.events.length,
    };

    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(`${SERVER_URL}/api/blackbox/report`, blob);
    } catch {
      // 静默失败
    }
  }

  // [v1.1] 统一上传逻辑（带熔断）
  private async upload(payload: unknown): Promise<void> {
    if (this.disabled) return;

    try {
      const response = await fetch(`${SERVER_URL}/api/blackbox/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // 成功 → 重置熔断器
      this.failCount = 0;
    } catch (err) {
      // [v1.1] 熔断器逻辑
      const now = Date.now();
      if (now - this.lastFailTime > this.CIRCUIT_BREAKER_WINDOW_MS) {
        this.failCount = 1; // 窗口外，重置计数
      } else {
        this.failCount++;
      }
      this.lastFailTime = now;

      if (this.failCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
        this.disabled = true;
        console.warn('[blackbox] auto-disabled after 3 failures (circuit breaker)');
      }
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

  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.listeners = [];
  }
}

// Singleton
export const blackbox = new EventBlackbox();

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).__blackbox = blackbox;
}
