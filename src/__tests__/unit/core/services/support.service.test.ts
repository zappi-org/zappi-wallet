import { describe, expect, it, vi } from 'vitest'
import { SupportService } from '@/core/services/support.service'
import type { CustomerSupportChannel } from '@/core/ports/driven/customer-support.port'
import type { SupportSnapshot } from '@/core/domain/support'

const snapshot: SupportSnapshot = {
  status: 'idle',
  availability: { available: true },
  capabilities: {
    attachments: {
      available: false,
      maxCount: 0,
      maxSizeBytes: 0,
    },
  },
  customerId: 'customer',
  tickets: [],
  messages: {},
  statusEvents: {},
}

function makeChannel(): CustomerSupportChannel {
  return {
    getAvailability: vi.fn().mockReturnValue(snapshot.availability),
    getSnapshot: vi.fn().mockReturnValue(snapshot),
    connect: vi.fn().mockResolvedValue(snapshot),
    disconnect: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(snapshot),
    createTicket: vi.fn().mockResolvedValue({
      id: 'ticket',
      threadId: 'thread',
      title: 'Title',
      body: 'Body',
      status: 'open',
      priority: 'normal',
      category: 'general',
      createdAt: 1,
      updatedAt: 1,
    }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    downloadAttachment: vi.fn().mockResolvedValue({
      name: 'file.txt',
      mime: 'text/plain',
      data: new Uint8Array([1]),
    }),
    markTicketRead: vi.fn().mockResolvedValue(undefined),
    setTicketPinned: vi.fn().mockResolvedValue(undefined),
    archiveTicket: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  }
}

describe('SupportService', () => {
  it('delegates support operations to the driven channel', async () => {
    const channel = makeChannel()
    const service = new SupportService(channel)

    expect(service.getAvailability()).toEqual({ available: true })
    expect(service.getSnapshot()).toBe(snapshot)
    await expect(service.connect()).resolves.toBe(snapshot)
    await service.createTicket({ title: 'Title', body: 'Body' })
    await service.sendMessage({ ticketId: 'ticket', body: 'Follow up' })
    await service.downloadAttachment({ attachmentId: 'attachment' })
    await service.markTicketRead('ticket', 1000)
    await service.setTicketPinned('ticket', 1500)
    await service.archiveTicket('ticket', 2000)
    service.subscribe(() => {})
    await service.refresh()
    await service.disconnect()
    await service.destroy()

    expect(channel.connect).toHaveBeenCalledOnce()
    expect(channel.createTicket).toHaveBeenCalledWith({
      title: 'Title',
      body: 'Body',
      priority: 'normal',
      category: 'transfer',
    })
    expect(channel.sendMessage).toHaveBeenCalledWith({ ticketId: 'ticket', body: 'Follow up' })
    expect(channel.downloadAttachment).toHaveBeenCalledWith({ attachmentId: 'attachment' })
    expect(channel.markTicketRead).toHaveBeenCalledWith('ticket', 1000)
    expect(channel.setTicketPinned).toHaveBeenCalledWith('ticket', 1500)
    expect(channel.archiveTicket).toHaveBeenCalledWith('ticket', 2000)
    expect(channel.subscribe).toHaveBeenCalledOnce()
    expect(channel.refresh).toHaveBeenCalledOnce()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(channel.destroy).toHaveBeenCalledOnce()
  })

  it('blocks follow-up messages for terminal support tickets before hitting the channel', async () => {
    const channel = makeChannel()
    vi.mocked(channel.getSnapshot).mockReturnValue({
      ...snapshot,
      tickets: [{
        id: 'ticket',
        threadId: 'thread',
        title: 'Title',
        body: 'Body',
        status: 'resolved',
        priority: 'normal',
        category: 'general',
        createdAt: 1,
        updatedAt: 1,
      }],
    })
    const service = new SupportService(channel)

    await expect(service.sendMessage({ ticketId: 'ticket', body: 'Follow up' }))
      .rejects.toThrow('Support ticket is already resolved')
    expect(channel.sendMessage).not.toHaveBeenCalled()
  })
})
