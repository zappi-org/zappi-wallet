import { createStore } from 'zustand/vanilla'
import type { Actions } from '@stackflow/react'
import { armRootSentinel } from './root-back-guard'
import { SCREEN_TO_ACTIVITY, SCREEN_TO_TAB, type Screen } from './types'

interface NavigationState {
  currentScreen: Screen
  stack: Screen[]
  previousOverride: Screen | null
}

export interface NavigationSnapshot {
  currentScreen: Screen
  previousScreen: Screen | null
  stack: readonly Screen[]
}

function makeInitialState(): NavigationState {
  return {
    currentScreen: 'home',
    stack: ['home'],
    previousOverride: null,
  }
}

const store = createStore<NavigationState>(() => makeInitialState())

let actions: Actions | null = null
let stackMounted = false
let cachedSnapshot: NavigationSnapshot = makeSnapshot(store.getState())

function makeSnapshot(next: NavigationState): NavigationSnapshot {
  return {
    currentScreen: next.currentScreen,
    previousScreen: next.previousOverride ?? next.stack.at(-2) ?? null,
    stack: next.stack,
  }
}

// Recompute the derived snapshot once per state change so useSyncExternalStore
// gets a stable reference (a fresh object every read would loop React forever).
store.subscribe((state) => {
  cachedSnapshot = makeSnapshot(state)
  // Re-arm the root back-guard whenever we settle on Home (no-op elsewhere).
  armRootSentinel()
})

// Marks the window during which a stack change is app-initiated. Every store-driven
// stackflow action stamps it right before dispatching; a stack change that arrives
// without a fresh stamp came from outside (OS back-swipe, browser buttons), which the
// browser already animated — the transition layer jump-cuts those to duration 0 instead
// of replaying our slide. Timestamped (not a boolean) so a stale mark self-expires.
const APP_NAV_WINDOW_MS = 600
let appInitiatedAt = 0

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Whether the current stack change originated outside the app. Read at transition-variant
 * computation time; the caller consumes the mark (below) once per transition so a later
 * external navigation inside the same window is not misread as app-initiated.
 */
export function isExternalNavigation(): boolean {
  return now() - appInitiatedAt >= APP_NAV_WINDOW_MS
}

/** Consume the app-initiated mark so it can't classify a second, unrelated transition. */
export function consumeNavigationMark(): void {
  appInitiatedAt = 0
}

function runStackAction(callback: (boundActions: Actions) => void): void {
  if (actions && stackMounted) {
    appInitiatedAt = now()
    callback(actions)
  }
}

export function bindStackflowActions(nextActions: Actions): void {
  actions = nextActions
}

export function subscribeNavigation(listener: () => void): () => void {
  return store.subscribe(listener)
}

export function getNavigationSnapshot(): NavigationSnapshot {
  return cachedSnapshot
}

export function setPreviousScreenOverride(screen: Screen | null): void {
  store.setState({ previousOverride: screen })
}

function isTabRoot(screen: Screen): boolean {
  return SCREEN_TO_TAB[screen] !== undefined
}

/**
 * Home is the permanent root; non-home tabs live one level above it.
 * Selecting a tab reshapes the stack to ['home'] or ['home', tab] so a back from any
 * tab always lands on Home instead of exiting the app. Switching between two non-home
 * tabs replaces in place (no home flash, history depth stays 2).
 */
function navigateToTabRoot(target: Screen, animate: boolean): void {
  const state = store.getState()

  if (target === 'home') {
    runStackAction((bound) => {
      if (state.stack.length > 1) bound.pop(state.stack.length - 1, { animate })
    })
    store.setState({ currentScreen: 'home', stack: ['home'], previousOverride: null })
    return
  }

  const activityName = SCREEN_TO_ACTIVITY[target]
  // A non-home tab already sitting directly above home is the "tab layer" we swap.
  const tabAboveHome = state.stack.length >= 2 && state.stack[0] === 'home' && isTabRoot(state.stack[1])
    ? state.stack[1]
    : null

  if (tabAboveHome === target && state.stack.length === 2) return // already on this tab

  runStackAction((bound) => {
    if (tabAboveHome) {
      // Drop any details above the tab layer, then replace the tab itself.
      if (state.stack.length > 2) bound.pop(state.stack.length - 2, { animate: false })
      bound.replace(activityName, {}, { animate })
    } else {
      // Top is home (possibly with details on top) — collapse to home, then push.
      if (state.stack.length > 1) bound.pop(state.stack.length - 1, { animate: false })
      bound.push(activityName, {}, { animate })
    }
  })

  store.setState({ currentScreen: target, stack: ['home', target], previousOverride: null })
}

export function navigateToScreen(
  target: Screen,
  options: { reset?: boolean; animate?: boolean; replace?: boolean } = {},
): void {
  const animate = options.animate ?? true
  const state = store.getState()
  if (target === state.currentScreen && !options.reset) return

  // The Home back-guard sentinel stays buried under pushes — removing it here would
  // race the plugin's pushState (history.back() is async); the guard skips it on pop.

  if (isTabRoot(target)) {
    navigateToTabRoot(target, animate)
    return
  }

  // Replace the top entry in place (replaceState, no new history entry) — for
  // activation-less auto-navigations (e.g. an incoming-review interrupt) that must not
  // push an entry iOS 16+ would later skip. Keeps stack depth and the return override,
  // since the screen is dismissed imperatively (previousScreen), not by a history pop.
  if (options.replace) {
    const activityName = SCREEN_TO_ACTIVITY[target]
    runStackAction((bound) => bound.replace(activityName, {}, { animate }))
    store.setState({
      currentScreen: target,
      stack: state.stack.length > 1 ? [...state.stack.slice(0, -1), target] : [target],
      previousOverride: state.previousOverride,
    })
    return
  }

  const existingIndex = options.reset ? -1 : state.stack.lastIndexOf(target)
  if (existingIndex >= 0) {
    const popCount = state.stack.length - 1 - existingIndex
    if (popCount > 0) {
      runStackAction((bound) => bound.pop(popCount, { animate }))
    }
    store.setState({
      currentScreen: target,
      stack: state.stack.slice(0, existingIndex + 1),
      previousOverride: state.previousOverride,
    })
    return
  }

  const activityName = SCREEN_TO_ACTIVITY[target]

  if (options.reset) {
    runStackAction((bound) => {
      if (state.stack.length > 1) bound.pop(state.stack.length - 1, { animate: false })
      bound.replace(activityName, {}, { animate })
    })
    store.setState({ currentScreen: target, stack: [target], previousOverride: null })
    return
  }

  runStackAction((bound) => bound.push(activityName, {}, { animate }))
  store.setState({
    currentScreen: target,
    stack: [...state.stack, target],
    previousOverride: state.previousOverride,
  })
}

export function navigateBack(): Screen {
  const state = store.getState()
  const target = state.previousOverride ?? state.stack.at(-2) ?? 'home'
  if (target === state.currentScreen) {
    store.setState({ previousOverride: null })
    return target
  }

  const onStackIndex = state.stack.lastIndexOf(target)
  if (onStackIndex >= 0) {
    // Real pop to an ancestor already on the stack.
    const popCount = state.stack.length - 1 - onStackIndex
    if (popCount > 0) {
      runStackAction((bound) => bound.pop(popCount, { animate: true }))
    }
    store.setState({
      currentScreen: target,
      stack: state.stack.slice(0, onStackIndex + 1),
      previousOverride: null,
    })
    return target
  }

  // Override points off-stack: replace the top in place — back must never grow history.
  const activityName = SCREEN_TO_ACTIVITY[target]
  runStackAction((bound) => bound.replace(activityName, {}, { animate: true }))
  store.setState({
    currentScreen: target,
    stack: [...state.stack.slice(0, -1), target],
    previousOverride: null,
  })
  return target
}

/**
 * A wallet must always open on Home. On cold boot historySyncPlugin restores
 * whatever URL the session last showed (#/send/, a detail screen…), which both
 * surprises users and can restore payload-dependent screens whose in-memory
 * state is gone. Replace the restored root with Home in place; in-session
 * navigation keeps full URL/back-forward sync. Acts on the actions directly —
 * the store mirror starts at ['home'] while the real stackflow root is the
 * restored screen, so navigateToScreen (which trusts the mirror) can't be used.
 */
function reconcileBootActivity(screen: Screen): boolean {
  if (screen === 'home') return false
  runStackAction((bound) => {
    bound.replace(SCREEN_TO_ACTIVITY.home, {}, { animate: false })
  })
  store.setState({ currentScreen: 'home', stack: ['home'], previousOverride: null })
  // The plugin flushes the replace (URL → #/) asynchronously; retry the root
  // sentinel once it has — armRootSentinel's home-URL guard makes early calls no-ops.
  setTimeout(armRootSentinel, 200)
  return true
}

/** Synchronizes imperative state when historySyncPlugin handles browser back/forward. */
export function reportActiveScreen(screen: Screen): void {
  if (!stackMounted) {
    stackMounted = true
    if (reconcileBootActivity(screen)) return
    if (screen !== store.getState().currentScreen) {
      store.setState({ currentScreen: screen, stack: [screen], previousOverride: null })
    }
    return
  }

  // An imperative navigation updates the snapshot before Stackflow renders it.
  if (screen === store.getState().currentScreen) return

  const state = store.getState()
  const existingIndex = state.stack.lastIndexOf(screen)
  store.setState({
    currentScreen: screen,
    stack: existingIndex >= 0 ? state.stack.slice(0, existingIndex + 1) : [...state.stack, screen],
    previousOverride: null,
  })
}

/** Test-only reset for the singleton navigation bridge. */
export function resetNavigationState(): void {
  stackMounted = false
  store.setState(makeInitialState(), true)
}
