interface ZoomRequest {
  track: MediaStreamTrack
  zoom: number
  generation: number
}

export interface NativeZoomRange {
  min: number
  max: number
  step?: number
}

function snapToZoomStep(zoom: number, range: NativeZoomRange): number {
  const clamped = Math.max(range.min, Math.min(range.max, zoom))
  const { step } = range
  if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) return clamped

  const stepIndex = Math.round((clamped - range.min) / step)
  const snapped = range.min + stepIndex * step
  return Math.max(range.min, Math.min(range.max, snapped))
}

/** Applies only the latest queued native zoom constraint. */
export class NativeZoomScheduler {
  private pending: ZoomRequest | null = null
  private applied: ZoomRequest | null = null
  private running = false
  private generation = 0

  request(track: MediaStreamTrack, zoom: number, range?: NativeZoomRange): void {
    const normalizedZoom = range ? snapToZoomStep(zoom, range) : zoom
    this.pending = { track, zoom: normalizedZoom, generation: this.generation }
    if (!this.running) void this.drain()
  }

  reset(): void {
    this.generation += 1
    this.pending = null
    this.applied = null
  }

  private async drain(): Promise<void> {
    this.running = true
    const generation = this.generation

    try {
      while (this.pending?.generation === generation) {
        const request = this.pending
        this.pending = null
        if (
          this.applied?.generation === generation
          && this.applied.track === request.track
          && this.applied.zoom === request.zoom
        ) {
          continue
        }

        try {
          await request.track.applyConstraints({
            advanced: [{ zoom: request.zoom } as MediaTrackConstraintSet],
          })
          if (this.generation === generation) this.applied = request
        } catch {
          // Continue with the latest queued request.
        }
      }
    } finally {
      this.running = false
      if (this.pending) void this.drain()
    }
  }
}
