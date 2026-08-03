export type QrPerformanceStage =
  | 'camera-playing'
  | 'fast-first-attempt'
  | 'fast-first-result'
  | 'first-ur-fragment'
  | 'robust-activated'

export interface QrPerformanceRecorder {
  mark(stage: QrPerformanceStage): void
}

interface RecorderOptions {
  enabled: boolean
  now(): number
  sink(stage: QrPerformanceStage, elapsed: number): void
}

export function createQrPerformanceRecorder(options: RecorderOptions): QrPerformanceRecorder {
  const startedAt = options.now()

  return {
    mark(stage) {
      if (options.enabled) options.sink(stage, options.now() - startedAt)
    },
  }
}
