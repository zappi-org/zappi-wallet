import { create } from 'zustand'

export const useChatView = create<{
  selectedId: string | null
  activeId: string | null
  submittedRequests: Record<string, true>
  markSubmitted: (conversationId: string, messageId: string) => void
  select: (id: string | null) => void
  setActive: (id: string | null) => void
}>((set) => ({
  selectedId: null,
  activeId: null,
  submittedRequests: {},
  markSubmitted: (conversationId, messageId) => set(state => {
    const entries = Object.entries(state.submittedRequests).slice(-999)
    return { submittedRequests: { ...Object.fromEntries(entries), [`${conversationId}:${messageId}`]: true } }
  }),
  select: (selectedId) => set({ selectedId }),
  setActive: (activeId) => set({ activeId }),
}))
