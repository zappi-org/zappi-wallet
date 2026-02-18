import type { StateCreator } from 'zustand'

/**
 * Toast notification
 */
export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

/**
 * Modal state
 */
export interface ModalState {
  isOpen: boolean
  type: string | null
  data?: Record<string, unknown>
}

/**
 * App mode
 */
export type AppMode = 'wallet'

/**
 * UI slice state
 */
export interface UISliceState {
  // Lock screen
  isLocked: boolean
  isUnlocking: boolean

  // Toasts
  toasts: Toast[]

  // Modal
  modal: ModalState

  // App mode
  appMode: AppMode

  // Loading states
  isInitializing: boolean
  isProcessingPayment: boolean

  // Input
  currentAmount: number

  // Notification
  lastNotificationCheckedAt: number | null

  // PWA update
  updateAvailable: boolean

  // Actions
  setLocked: (locked: boolean) => void
  setUnlocking: (unlocking: boolean) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void
  openModal: (type: string, data?: Record<string, unknown>) => void
  closeModal: () => void
  setAppMode: (mode: AppMode) => void
  setInitializing: (initializing: boolean) => void
  setProcessingPayment: (processing: boolean) => void
  setCurrentAmount: (amount: number) => void
  markNotificationsRead: () => void
  setUpdateAvailable: (available: boolean) => void
  reset: () => void
}

/**
 * Initial UI state
 */
const initialState = {
  isLocked: true,
  isUnlocking: false,
  toasts: [] as Toast[],
  modal: { isOpen: false, type: null } as ModalState,
  appMode: 'wallet' as AppMode,
  isInitializing: true,
  isProcessingPayment: false,
  currentAmount: 0,
  lastNotificationCheckedAt: null as number | null,
  updateAvailable: false,
}

/**
 * Generate unique toast ID
 */
function generateToastId(): string {
  return `toast-${crypto.randomUUID()}`
}

/**
 * UI slice creator
 */
export const createUISlice: StateCreator<UISliceState> = (set) => ({
  ...initialState,

  setLocked: (isLocked) => set({ isLocked }),

  setUnlocking: (isUnlocking) => set({ isUnlocking }),

  addToast: (toast) => {
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: generateToastId() }],
    }))
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),

  openModal: (type, data) =>
    set({
      modal: { isOpen: true, type, data },
    }),

  closeModal: () =>
    set({
      modal: { isOpen: false, type: null, data: undefined },
    }),

  setAppMode: (appMode) => set({ appMode }),

  setInitializing: (isInitializing) => set({ isInitializing }),

  setProcessingPayment: (isProcessingPayment) => set({ isProcessingPayment }),

  setCurrentAmount: (currentAmount) => set({ currentAmount }),

  markNotificationsRead: () => set({ lastNotificationCheckedAt: Date.now() }),

  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),

  reset: () => set(initialState),
})
