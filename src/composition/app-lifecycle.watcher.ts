/**
 * AppLifecycleWatcher — 앱 포그라운드/백그라운드 전환 감시
 *
 * MainApp의 inline visibilitychange 핸들러를 추출한 watcher.
 * 콜백 주입으로 외부 의존성 분리 — core/ports에만 의존.
 */

export interface AppLifecycleCallbacks {
  /** 앱이 포그라운드로 돌아올 때 */
  onResume: () => Promise<void>
  /** 앱이 백그라운드로 갈 때 */
  onPause: () => Promise<void>
}

export class AppLifecycleWatcher {
  private handler: (() => void) | null = null

  constructor(private callbacks: AppLifecycleCallbacks) {}

  start(): void {
    if (this.handler) return

    this.handler = () => {
      if (document.visibilityState === 'visible') {
        this.callbacks.onResume().catch((e) =>
          console.error('[AppLifecycle] Resume failed:', e),
        )
      } else {
        this.callbacks.onPause().catch((e) =>
          console.error('[AppLifecycle] Pause failed:', e),
        )
      }
    }

    document.addEventListener('visibilitychange', this.handler)
  }

  stop(): void {
    if (this.handler) {
      document.removeEventListener('visibilitychange', this.handler)
      this.handler = null
    }
  }
}
