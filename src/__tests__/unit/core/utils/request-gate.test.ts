import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RequestGate } from '@/core/utils/request-gate'

describe('RequestGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares the in-flight promise — concurrent calls run the task once', async () => {
    const gate = new RequestGate({ cooldownMs: 0 })
    let resolveTask!: (v: string) => void
    const task = vi.fn(
      () => new Promise<string>((resolve) => { resolveTask = resolve }),
    )

    const p1 = gate.run('k', task)
    const p2 = gate.run('k', task)

    expect(task).toHaveBeenCalledTimes(1)
    resolveTask('done')
    await expect(p1).resolves.toEqual({ value: 'done', stale: false })
    await expect(p2).resolves.toEqual({ value: 'done', stale: false })
  })

  it('returns the previous value as stale within the success cooldown', async () => {
    const gate = new RequestGate({ cooldownMs: 30_000 })
    const task = vi.fn().mockResolvedValue('first')

    await expect(gate.run('k', task)).resolves.toEqual({ value: 'first', stale: false })

    vi.advanceTimersByTime(29_999)
    await expect(gate.run('k', task)).resolves.toEqual({ value: 'first', stale: true })
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('re-runs the task after the success cooldown elapses', async () => {
    const gate = new RequestGate({ cooldownMs: 30_000 })
    const task = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await gate.run('k', task)
    vi.advanceTimersByTime(30_000)
    await expect(gate.run('k', task)).resolves.toEqual({ value: 'second', stale: false })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('cooldownMs 0 never returns stale — always re-runs when not in flight', async () => {
    const gate = new RequestGate({ cooldownMs: 0 })
    const task = vi.fn().mockResolvedValue('v')

    await gate.run('k', task)
    await gate.run('k', task)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('re-throws the same rejection within the failure cooldown without re-running', async () => {
    const gate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 30_000 })
    const boom = new Error('boom')
    const task = vi.fn().mockRejectedValue(boom)

    await expect(gate.run('k', task)).rejects.toBe(boom)
    expect(task).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_000)
    await expect(gate.run('k', task)).rejects.toBe(boom)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('re-runs the task after the failure cooldown elapses', async () => {
    const gate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 30_000 })
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered')

    await expect(gate.run('k', task)).rejects.toThrow('boom')
    vi.advanceTimersByTime(30_000)
    await expect(gate.run('k', task)).resolves.toEqual({ value: 'recovered', stale: false })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('failureCooldownMs 0 retries immediately after a failure', async () => {
    const gate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 0 })
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')

    await expect(gate.run('k', task)).rejects.toThrow('boom')
    await expect(gate.run('k', task)).resolves.toEqual({ value: 'ok', stale: false })
  })

  it('a success clears the recorded failure', async () => {
    const gate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 60_000 })
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok')

    await expect(gate.run('k', task)).rejects.toThrow('boom')
    vi.advanceTimersByTime(60_000)
    await gate.run('k', task)
    // after a success, no failure cooldown should remain
    await expect(gate.run('k', task)).resolves.toEqual({ value: 'ok', stale: false })
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('keys are isolated from each other', async () => {
    const gate = new RequestGate({ cooldownMs: 30_000 })
    const taskA = vi.fn().mockResolvedValue('a')
    const taskB = vi.fn().mockResolvedValue('b')

    await gate.run('a', taskA)
    await expect(gate.run('b', taskB)).resolves.toEqual({ value: 'b', stale: false })
    expect(taskB).toHaveBeenCalledTimes(1)
  })

  it('invalidate clears the cooldown for a key', async () => {
    const gate = new RequestGate({ cooldownMs: 30_000 })
    const task = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await gate.run('k', task)
    gate.invalidate('k')
    await expect(gate.run('k', task)).resolves.toEqual({ value: 'second', stale: false })
  })

  it('captures synchronous throws from the task as rejections', async () => {
    const gate = new RequestGate({ cooldownMs: 0, failureCooldownMs: 0 })
    const task = vi.fn(() => {
      throw new Error('sync boom')
    })

    await expect(gate.run('k', task as unknown as () => Promise<never>)).rejects.toThrow('sync boom')
  })
})
