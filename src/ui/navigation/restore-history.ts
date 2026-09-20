import { parse } from 'flatted'

const STATE_TAG = '@stackflow/plugin-history-sync'

type RecordValue = Record<string, unknown>
function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRestorable(
  state: RecordValue,
  registered: ReadonlySet<string>
): boolean {
  try {
    if (typeof state.flattedState !== 'string') return false
    const decoded: unknown = parse(state.flattedState)
    if (!isRecord(decoded) || !isRecord(decoded.activity)) return false
    const activity = decoded.activity
    const entered = activity.enteredBy
    return (
      typeof activity.name === 'string' &&
      registered.has(activity.name) &&
      typeof activity.id === 'string' &&
      isRecord(entered) &&
      entered.activityName === activity.name &&
      entered.activityId === activity.id &&
      (entered.name === 'Pushed' || entered.name === 'Replaced') &&
      typeof entered.id === 'string' &&
      typeof entered.eventDate === 'number' &&
      Number.isFinite(entered.eventDate) &&
      isRecord(entered.activityParams)
    )
  } catch {
    return false
  }
}

/** Remove only invalid navigation state before historySyncPlugin captures it. */
export function sanitizeInitialHistory(
  registered: ReadonlySet<string>
): boolean {
  if (typeof window === 'undefined') return false
  const state: unknown = window.history.state
  if (!isRecord(state)) return false
  const nested = isRecord(state.usr) && state.usr._TAG === STATE_TAG
  const serialized = nested ? (state.usr as RecordValue) : state
  if (serialized._TAG !== STATE_TAG || isRestorable(serialized, registered))
    return false

  const next = { ...state }
  if (nested) {
    next.usr = null
  } else {
    delete next._TAG
    delete next.flattedState
  }
  window.history.replaceState(next, '')
  return true
}
