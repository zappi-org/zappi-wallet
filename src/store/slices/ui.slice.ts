import type { StateCreator } from 'zustand'

/**
 * Toast notification
 */
export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
  onAction?: () => void
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

  // Loading states
  isInitializing: boolean
  isProcessingPayment: boolean

  // Input
  currentAmount: number

  // Notification
  lastNotificationCheckedAt: number | null
  supportUnreadCount: number
  supportUnreadTicketIds: string[]
  activeSupportTicketId: string | null

  // PWA update
  updateAvailable: boolean

  // GiftWrap watcher pause (TLS test pages)
  pauseGiftWrap: boolean

  // Actions
  setLocked: (locked: boolean) => void
  setUnlocking: (unlocking: boolean) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void
  openModal: (type: string, data?: Record<string, unknown>) => void
  closeModal: () => void
  setInitializing: (initializing: boolean) => void
  setProcessingPayment: (processing: boolean) => void
  setCurrentAmount: (amount: number) => void
  markNotificationsRead: () => void
  setSupportUnreadSummary: (count: number, ticketIds: string[]) => void
  setActiveSupportTicketId: (ticketId: string | null) => void
  setUpdateAvailable: (available: boolean) => void
  setPauseGiftWrap: (paused: boolean) => void
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
  isInitializing: true,
  isProcessingPayment: false,
  currentAmount: 0,
  lastNotificationCheckedAt: null as number | null,
  supportUnreadCount: 0,
  supportUnreadTicketIds: [] as string[],
  activeSupportTicketId: null as string | null,
  updateAvailable: false,
  pauseGiftWrap: false,
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

  setInitializing: (isInitializing) => set({ isInitializing }),

  setProcessingPayment: (isProcessingPayment) => set({ isProcessingPayment }),

  setCurrentAmount: (currentAmount) => set({ currentAmount }),

  markNotificationsRead: () => set({ lastNotificationCheckedAt: Date.now() }),

  setSupportUnreadSummary: (supportUnreadCount, supportUnreadTicketIds) =>
    set({ supportUnreadCount, supportUnreadTicketIds }),

  setActiveSupportTicketId: (activeSupportTicketId) => set({ activeSupportTicketId }),

  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),

  setPauseGiftWrap: (pauseGiftWrap) => set({ pauseGiftWrap }),

  reset: () => set(initialState),
})
