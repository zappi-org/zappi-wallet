import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { defineConfig } from '@stackflow/config'
import { stackflow, type ActivityComponentType, useActivity, useStack, useStepFlow } from '@stackflow/react'
import { basicRendererPlugin } from '@stackflow/plugin-renderer-basic'
import { devtoolsPlugin } from '@stackflow/plugin-devtools'
import { historySyncPlugin } from '@stackflow/plugin-history-sync'
import { bindStackflowActions, reportActiveScreen } from './navigation-store'
import { installRootBackGuard } from './root-back-guard'
import { SCREEN_TO_ACTIVITY, type Screen, type StackActivityName } from './types'
import { ActivityStepNavigationContext } from './activity-step-navigation'
import { motionSafeTransition } from '@/ui/utils/motion'

type EmptyParams = Record<never, never>

declare module '@stackflow/config' {
  interface Register {
    Home: EmptyParams
    Token: EmptyParams
    Settings: EmptyParams
    Contacts: EmptyParams
    History: EmptyParams
    Notifications: EmptyParams
    Transfer: EmptyParams
    Analytics: EmptyParams
    AddMint: EmptyParams
    MintManagement: EmptyParams
    RelayManagement: EmptyParams
    AmountAction: EmptyParams
    Send: EmptyParams
    Receive: EmptyParams
    UsernameChange: EmptyParams
    TransactionDetail: EmptyParams
    MintDetail: EmptyParams
    TokenDetail: EmptyParams
    TokenEasterEgg: EmptyParams
  }
}

const ACTIVITY_ROUTES: Record<StackActivityName, string> = {
  Home: '/',
  Token: '/token',
  Settings: '/settings',
  Contacts: '/contacts',
  History: '/history',
  Notifications: '/notifications',
  Transfer: '/transfer',
  Analytics: '/analytics',
  AddMint: '/mints/add',
  MintManagement: '/mints',
  RelayManagement: '/relays',
  AmountAction: '/amount',
  Send: '/send',
  Receive: '/receive',
  UsernameChange: '/settings/username',
  TransactionDetail: '/transactions/detail',
  MintDetail: '/mints/detail',
  TokenDetail: '/token/detail',
  TokenEasterEgg: '/token/easter-egg',
}

const config = defineConfig({
  activities: (Object.entries(ACTIVITY_ROUTES) as Array<[StackActivityName, string]>).map(([name, route]) => ({
    name,
    route,
  })),
  initialActivity: () => 'Home',
  transitionDuration: 220,
})

type ScreenRenderer = (screen: Screen) => ReactNode
const ScreenRendererContext = createContext<ScreenRenderer | null>(null)

// Render epoch: the renderer closure is exposed via a stable identity (so background
// activities never re-render on unrelated MainApp ticks), but the TOP activity still
// needs fresh props when MainApp state changes. MainApp bumps this epoch each render and
// only the top activity subscribes — background screens stay frozen (and are hidden by
// visibility anyway), the top screen re-reads the latest closure.
let renderEpoch = 0
const epochListeners = new Set<() => void>()
function bumpRenderEpoch(): void {
  renderEpoch += 1
  epochListeners.forEach((listener) => listener())
}
function subscribeRenderEpoch(listener: () => void): () => void {
  epochListeners.add(listener)
  return () => epochListeners.delete(listener)
}
function getRenderEpoch(): number {
  return renderEpoch
}

function ScreenActivity({ screen }: { screen: Screen }) {
  const renderScreen = useContext(ScreenRendererContext)
  const activity = useActivity()
  const stack = useStack()
  // Only the top activity tracks the render epoch, so a MainApp tick re-renders the
  // visible screen (fresh props) without waking hidden background activities.
  const epochSnapshot = useCallback(() => (activity.isTop ? getRenderEpoch() : 0), [activity.isTop])
  useSyncExternalStore(subscribeRenderEpoch, epochSnapshot, epochSnapshot)
  const stepFlow = useStepFlow(SCREEN_TO_ACTIVITY[screen])
  const reduceMotion = useReducedMotion()
  const isLeaving = activity.transitionState === 'exit-active'
  const isTransitioning = activity.transitionState === 'enter-active' || activity.transitionState === 'exit-active'
  // Occluded only by a settled screen above — an exit-active (popping) or enter-active
  // (still animating in) screen above must leave this one painted so the reveal/cross-fade
  // isn't a hard flash.
  const isCovered = stack.activities.some(
    (other) => other.zIndex > activity.zIndex && other.transitionState === 'enter-done',
  )
  const pushStep = useCallback(() => {
    stepFlow.pushStep({}, { targetActivityId: activity.id })
  }, [stepFlow, activity.id])
  const popStep = useCallback(() => {
    stepFlow.popStep({ targetActivityId: activity.id })
  }, [stepFlow, activity.id])
  const stepNavigation = useMemo(
    () => ({
      stepDepth: Math.max(0, activity.steps.length - 1),
      pushStep,
      popStep,
    }),
    [activity.steps.length, pushStep, popStep],
  )

  useEffect(() => {
    if (activity.isTop) reportActiveScreen(screen)
  }, [activity.isTop, screen])

  if (!renderScreen) return null

  return (
    <ActivityStepNavigationContext.Provider value={stepNavigation}>
      <motion.div
        initial={
          activity.isRoot || reduceMotion
            ? { opacity: 1, transform: 'translate3d(0, 0, 0)' }
            : { opacity: 0.98, transform: 'translate3d(100%, 0, 0)' }
        }
        animate={
          reduceMotion
            ? { opacity: isLeaving ? 0 : 1, transform: 'translate3d(0, 0, 0)' }
            : {
                opacity: isLeaving ? 0.98 : 1,
                transform: isLeaving ? 'translate3d(100%, 0, 0)' : 'translate3d(0, 0, 0)',
              }
        }
        transition={motionSafeTransition(reduceMotion, { duration: 0.22, ease: [0.32, 0.72, 0, 1] })}
        className="absolute inset-0 bg-background"
        style={{
          zIndex: activity.zIndex,
          pointerEvents: activity.isTop ? 'auto' : 'none',
          // Only reserve a compositor layer while actually animating; drop painting for
          // fully occluded background screens.
          willChange: isTransitioning ? 'transform, opacity' : undefined,
          visibility: isCovered ? 'hidden' : 'visible',
        }}
      >
        {renderScreen(screen)}
      </motion.div>
    </ActivityStepNavigationContext.Provider>
  )
}

function makeScreenActivity<Name extends StackActivityName>(
  _activityName: Name,
  screen: Screen,
): ActivityComponentType<Name> {
  const Activity = () => <ScreenActivity screen={screen} />
  Activity.displayName = `${_activityName}Activity`
  return Activity as ActivityComponentType<Name>
}

const components = {
  Home: makeScreenActivity('Home', 'home'),
  Token: makeScreenActivity('Token', 'token'),
  Settings: makeScreenActivity('Settings', 'settings'),
  Contacts: makeScreenActivity('Contacts', 'contacts'),
  History: makeScreenActivity('History', 'history'),
  Notifications: makeScreenActivity('Notifications', 'notifications'),
  Transfer: makeScreenActivity('Transfer', 'transfer'),
  Analytics: makeScreenActivity('Analytics', 'analytics'),
  AddMint: makeScreenActivity('AddMint', 'add-mint'),
  MintManagement: makeScreenActivity('MintManagement', 'mint-management'),
  RelayManagement: makeScreenActivity('RelayManagement', 'relay-management'),
  AmountAction: makeScreenActivity('AmountAction', 'amount-action'),
  Send: makeScreenActivity('Send', 'send'),
  Receive: makeScreenActivity('Receive', 'receive'),
  UsernameChange: makeScreenActivity('UsernameChange', 'username-change'),
  TransactionDetail: makeScreenActivity('TransactionDetail', 'transaction-detail'),
  MintDetail: makeScreenActivity('MintDetail', 'mint-detail'),
  TokenDetail: makeScreenActivity('TokenDetail', 'token-detail'),
  TokenEasterEgg: makeScreenActivity('TokenEasterEgg', 'token-easter-egg'),
}

const { Stack, actions } = stackflow({
  config,
  components,
  plugins: [
    basicRendererPlugin(),
    // Dev-only: feeds the Stackflow browser-extension inspector; the DEV gate
    // lets the prod bundle tree-shake it away entirely.
    ...(import.meta.env.DEV ? [devtoolsPlugin()] : []),
    historySyncPlugin({
      config,
      fallbackActivity: () => SCREEN_TO_ACTIVITY.home,
      // Hash routing works on static PWA hosts without server rewrite rules.
      useHash: true,
    }),
  ],
})

bindStackflowActions(actions)

// The Stack element is fully driven by stackflow's own store; memoizing it keeps
// unrelated MainApp re-renders (toast/balance ticks) from re-rendering every mounted
// activity. State-subscribed screens read their own zustand stores, so the top screen
// still updates independently of this identity.
const MemoStack = <Stack />

export function AppStack({ renderScreen }: { renderScreen: ScreenRenderer }) {
  // Latest-ref: expose one stable renderer identity as the context value so background
  // activities don't re-render when MainApp re-renders, while each render still sees the
  // fresh closure (with current state) when stackflow itself re-renders an activity.
  const renderRef = useRef(renderScreen)
  const stableRender = useMemo<ScreenRenderer>(() => (screen) => renderRef.current(screen), [])

  // Commit the fresh closure then wake the top activity with it — after each MainApp
  // render, before paint, so the visible screen never shows stale props.
  useLayoutEffect(() => {
    renderRef.current = renderScreen
    bumpRenderEpoch()
  })

  useEffect(() => installRootBackGuard(), [])

  return <ScreenRendererContext.Provider value={stableRender}>{MemoStack}</ScreenRendererContext.Provider>
}
