import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'
import type { ChatMessage, Conversation } from '@/core/domain/chat'
import { PaymentRequest } from '@cashu/cashu-ts'
import { nip19 } from 'nostr-tools'
import ko from '@/i18n/locales/ko'
import { useChatView } from '@/store/chat-view'
import ChatScreen from '@/ui/screens/Chat/ChatScreen'
import ChatListScreen from '@/ui/screens/Chat/ChatListScreen'
import { encodeChatPaymentNotice } from '@/core/domain/chat-payment'

vi.mock('@/ui/components/common/QRCodeDisplay', () => ({
  QRCodeDisplay: () => null,
}))
vi.mock('@/ui/components/common/QrScannerModal', () => ({
  QrScannerModal: () => null,
}))

const codec = new TokenCodecAdapter()
const owner = 'a'.repeat(64)
const peer = 'b'.repeat(64)
const conversation: Conversation = {
  id: 'request-chat',
  account: owner,
  peer,
  channel: 'direct',
  updatedAt: Date.now(),
  unread: 0,
  pinned: false,
  muted: false,
  blocked: false,
  preview: '',
  draft: '',
}
let messages: ChatMessage[] = []
const registry = {
  transactionMgmt: { getById: vi.fn().mockResolvedValue(null) },
  crypto: { encodeNpub: (value: string) => value },
  inputParser: {
    decodeCashuRequest: (value: string) => codec.decodePaymentRequest(value),
  },
}
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const value = key
        .split('.')
        .reduce<unknown>(
          (current, part) =>
            current && typeof current === 'object'
              ? (current as Record<string, unknown>)[part]
              : undefined,
          ko
        )
      return typeof value === 'string'
        ? value.replace(
            /{{(\w+)}}/g,
            (_, name: string) => options?.[name] ?? ''
          )
        : key
    },
    i18n: { language: 'ko' },
  }),
}))
vi.mock('@/ui/hooks/use-chat', () => ({
  useChat: () => ({
    conversations: [conversation],
    messages,
    ready: true,
    chat: {
      update: vi.fn().mockResolvedValue(undefined),
      markRead: vi.fn().mockResolvedValue(undefined),
    },
  }),
}))
vi.mock('@/ui/hooks/use-contacts', () => ({
  useContacts: () => ({
    contacts: [{ id: 'peer', name: '지민', address: peer }],
    createContact: vi.fn(),
    updateContact: vi.fn(),
  }),
}))
vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => registry,
}))
vi.mock('@/ui/screens/Contacts/ContactFormModal', () => ({
  ContactFormModal: () => null,
}))

const oldScrollTo = HTMLElement.prototype.scrollTo
const oldResizeObserver = globalThis.ResizeObserver
HTMLElement.prototype.scrollTo = function (
  options: ScrollToOptions | number = {}
) {
  if (typeof options !== 'number')
    this.scrollTop = options.top ?? this.scrollTop
}
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
afterAll(() => {
  HTMLElement.prototype.scrollTo = oldScrollTo
  globalThis.ResizeObserver = oldResizeObserver
})
beforeEach(() => {
  registry.transactionMgmt.getById.mockReset().mockResolvedValue(null)
  messages = []
  conversation.preview = ''
  useChatView.setState({ selectedId: conversation.id, submittedRequests: {} })
})

function createRequest(outgoing: boolean, description?: string) {
  const { request } = codec.createNostrPaymentRequest({
    amount: 1234,
    unit: 'sat',
    description,
    mints: ['https://mint.example'],
    pubkey: nip19.nprofileEncode({
      pubkey: outgoing ? owner : peer,
      relays: ['wss://relay.example'],
    }),
  })
  expect(request).toMatch(/^CREQB/)
  const message: ChatMessage = {
    id: 'encoded-request',
    conversationId: conversation.id,
    sender: outgoing ? owner : peer,
    recipient: outgoing ? peer : owner,
    content: request,
    outgoing,
    status: outgoing ? 'sent' : 'received',
    createdAt: Date.now(),
  }
  messages = [message]
  conversation.preview = request.slice(0, 160)
  return request
}

describe('real encoded chat payment requests', () => {
  it.each([true, false])(
    'keeps one verified request card for requester=%s with transaction details',
    async (outgoing) => {
      const raw = createRequest(outgoing)
      const request = messages[0]
      const deliveryId = 'c'.repeat(64)
      const localId = outgoing ? deliveryId : 'local-send'
      const notice: ChatMessage = {
        ...request,
        id: 'payment-notice',
        outgoing: !outgoing,
        sender: request.recipient,
        recipient: request.sender,
        status: 'sent',
        content: encodeChatPaymentNotice({
          amount: 1234,
          unit: 'sat',
          recipient: request.sender,
          transactionId: 'local-send',
          requestMessageId: request.id,
          deliveryId,
        }),
        ...(!outgoing
          ? {
              payment: {
                kind: 'send' as const,
                amount: 1234,
                transactionId: localId,
                requestMessageId: request.id,
              },
            }
          : {}),
      }
      messages.push(notice)
      registry.transactionMgmt.getById.mockResolvedValue({
        id: localId,
        direction: outgoing ? 'receive' : 'send',
        status: 'settled',
        amount: { value: 1234n, unit: 'sat' },
        metadata: {
          paymentDelivery: {
            id: deliveryId,
            sender: notice.sender,
            recipient: notice.recipient,
            amount: 1234,
            requestId: codec.decodePaymentRequest(raw).id,
          },
        },
      })
      const onDetails = vi.fn().mockResolvedValue(undefined)
      render(
        <ChatScreen
          onBack={vi.fn()}
          onSend={vi.fn()}
          onRequest={vi.fn()}
          onPay={vi.fn()}
          onDetails={onDetails}
        />
      )
      await waitFor(() => expect(screen.getAllByRole('region')).toHaveLength(1))
      expect(screen.getByRole('region')).toHaveAccessibleName(
        outgoing ? '지민님에게 요청' : '지민님의 송금 요청'
      )
      expect(
        screen.getByText(outgoing ? '입금 완료' : '송금 완료')
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: '송금하기' })
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '거래 내역' }))
      expect(onDetails).toHaveBeenCalledWith(localId)
    }
  )

  it('keeps a failed payment-notice delivery visible for retry', async () => {
    createRequest(false)
    const request = messages[0]
    messages.push({
      ...request,
      id: 'notice',
      sender: owner,
      recipient: peer,
      outgoing: true,
      status: 'failed',
      content: encodeChatPaymentNotice({
        amount: 1234,
        unit: 'sat',
        recipient: peer,
        transactionId: 'local-send',
        requestMessageId: request.id,
      }),
      payment: {
        kind: 'send',
        transactionId: 'local-send',
        amount: 1234,
        requestMessageId: request.id,
      },
    })
    registry.transactionMgmt.getById.mockResolvedValue({
      id: 'local-send',
      direction: 'send',
      status: 'settled',
      amount: { value: 1234n, unit: 'sat' },
    })
    render(
      <ChatScreen
        onBack={vi.fn()}
        onSend={vi.fn()}
        onRequest={vi.fn()}
        onPay={vi.fn()}
        onDetails={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(screen.getAllByText('송금 완료')).toHaveLength(2)
    )
    expect(screen.getAllByRole('region')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: ko.common.retry })
    ).toBeInTheDocument()
  })
  it('shows the sender-written memo instead of generic helper copy', () => {
    createRequest(false, '저녁값')
    render(
      <ChatScreen
        onBack={vi.fn()}
        onSend={vi.fn()}
        onRequest={vi.fn()}
        onPay={vi.fn()}
      />
    )
    expect(screen.getByText('저녁값')).toBeInTheDocument()
  })
  it.each([true, false])(
    'renders a request card for outgoing=%s without exposing the encoded request',
    async (outgoing) => {
      const request = createRequest(outgoing)
      const onPay = vi.fn().mockResolvedValue(undefined)
      render(
        <ChatScreen
          onBack={vi.fn()}
          onSend={vi.fn()}
          onRequest={vi.fn()}
          onPay={onPay}
        />
      )
      const card = screen.getByRole('region', {
        name: outgoing ? '지민님에게 요청' : '지민님의 송금 요청',
      })
      expect(card).toHaveTextContent('1,234')
      expect(card).toHaveTextContent('sat')
      expect(document.body).not.toHaveTextContent('CREQB')
      if (outgoing) {
        expect(
          screen.queryByRole('button', { name: '송금하기' })
        ).not.toBeInTheDocument()
      } else {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '송금하기' }))
        })
        expect(onPay).toHaveBeenCalledExactlyOnceWith(
          request,
          'encoded-request'
        )
      }
    }
  )

  it('preserves a legacy case-sensitive base64 request when paying from the card', async () => {
    const encoded = createRequest(false)
    const request =
      PaymentRequest.fromEncodedRequest(encoded).toEncodedRequest()
    expect(request).toMatch(/^creqA/)
    messages = [{ ...messages[0], content: request }]
    const onPay = vi.fn().mockResolvedValue(undefined)
    render(
      <ChatScreen
        onBack={vi.fn()}
        onSend={vi.fn()}
        onRequest={vi.fn()}
        onPay={onPay}
      />
    )
    expect(
      screen.getByRole('region', { name: '지민님의 송금 요청' })
    ).toHaveTextContent('1,234')
    expect(document.body).not.toHaveTextContent(request)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '송금하기' }))
    })
    expect(onPay).toHaveBeenCalledExactlyOnceWith(request, 'encoded-request')
  })

  it('expires an incoming request from signed message metadata without a local payment record', async () => {
    vi.useFakeTimers()
    try {
      createRequest(false)
      messages = [{ ...messages[0], expiresAt: Date.now() + 1000 }]
      expect(messages[0].payment).toBeUndefined()
      const onPay = vi.fn().mockResolvedValue(undefined)
      const view = render(
        <ChatScreen
          onBack={vi.fn()}
          onSend={vi.fn()}
          onRequest={vi.fn()}
          onPay={onPay}
        />
      )
      expect(
        screen.getByRole('button', { name: '송금하기' })
      ).toBeInTheDocument()
      await act(async () => {
        vi.advanceTimersByTime(1001)
      })
      expect(screen.getByText('만료됨')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: '송금하기' })
      ).not.toBeInTheDocument()
      expect(onPay).not.toHaveBeenCalled()
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a friendly list preview for a truncated real request', () => {
    createRequest(false)
    render(<ChatListScreen onOpen={vi.fn()} />)
    expect(screen.getByText('송금 요청')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('CREQB')
  })
})
