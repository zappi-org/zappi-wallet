import { useState, useCallback, useMemo } from 'react'
import { Plus, Search, Trash2, Pencil, Zap, Hash, Link, BookUser, ArrowUpRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { EmptyState } from '@/ui/components/common/EmptyState'
import { ConfirmDialog } from '@/ui/components/common/ConfirmDialog'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { ContactFormModal } from './ContactFormModal'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import type { ValidatedData } from '@/core/domain/input-types'
import { useAppStore } from '@/store'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { Contact, ContactAddressType } from '@/core/types'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { isNostrDirectAddress } from '@/core/domain/nostr-address'

function detectAddressType(address: string): 'lightning' | 'npub' | 'custom' {
  const trimmed = address.trim()
  if (trimmed.includes('@')) return 'lightning'
  if (trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) return 'npub'
  return 'custom'
}

export interface ContactsScreenProps {
  /** Called with validated data + contact name + selected mint when send is confirmed */
  onSendToContact?: (validatedData: ValidatedData, displayName: string, mintUrl: string) => void
}

const addressTypeIcon: Record<ContactAddressType, typeof Zap> = {
  lightning: Zap,
  npub: Hash,
  custom: Link,
}

export function ContactsScreen({ onSendToContact }: ContactsScreenProps) {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const settings = useAppStore((s) => s.settings)
  const inputParser = useInputParser()
  const { nostrDirectPayment } = useServiceRegistry()
  const { contacts, createContact, updateContact, deleteContact: deleteContactById } = useContacts()
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [pendingSend, setPendingSend] = useState<{ data: ValidatedData; name: string; commonMintUrls?: string[] } | null>(null)

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return contacts
    const q = searchQuery.toLowerCase()
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
    )
  }, [contacts, searchQuery])

  const handleSave = useCallback(async (data: { name: string; address: string }) => {
    const addressType = detectAddressType(data.address)
    if (editingContact) {
      await updateContact(editingContact.id, { ...data, addressType })
    } else {
      await createContact({ ...data, addressType })
    }
    setEditingContact(null)
  }, [editingContact, createContact, updateContact])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await deleteContactById(deleteTarget.id)
    setDeleteTarget(null)
    setExpandedId(null)
  }, [deleteTarget, deleteContactById])

  const handleEdit = useCallback((contact: Contact) => {
    setEditingContact(contact)
    setShowForm(true)
    setExpandedId(null)
  }, [])

  const handleAdd = useCallback(() => {
    setEditingContact(null)
    setShowForm(true)
  }, [])

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => prev === id ? null : id)
  }, [])

  const handleSend = useCallback(async (contact: Contact) => {
    if (!onSendToContact) return
    setSendingId(contact.id)
    try {
      if (contact.addressType === 'npub' && isNostrDirectAddress(contact.address)) {
        const resolution = await nostrDirectPayment.resolve({
          address: contact.address,
          ownMintUrls: settings.mints,
          selectedMintUrl: null,
        })

        if (resolution.status === 'ready' || resolution.status === 'needs-mint-selection') {
          setPendingSend({
            data: resolution.validatedData,
            name: contact.name,
            commonMintUrls: resolution.commonMintUrls,
          })
          return
        }

        const message = resolution.status === 'no-common-mint'
          ? t('send.destination.noCommonMint')
          : resolution.status === 'no-relay'
            ? t('send.destination.relayNotFound')
            : t('send.destination.ecashInfoNotFound')
        addToast({ type: 'error', message, duration: 3000 })
        return
      }

      const detected = inputParser.detectAndClassify(contact.address)
      if (detected.type === 'unknown') {
        addToast({ type: 'error', message: t('send.destination.unrecognized'), duration: 3000 })
        return
      }
      try {
        const validated = await inputParser.validateAsync(detected)
        setPendingSend({ data: validated, name: contact.name })
      } catch (err) {
        addToast({ type: 'error', message: err instanceof Error ? err.message : t('send.destination.unrecognized'), duration: 3000 })
      }
    } finally {
      setSendingId(null)
    }
  }, [onSendToContact, addToast, t, inputParser, settings.mints, nostrDirectPayment])

  return (
    <div className="h-full bg-background text-foreground flex flex-col pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <div className="w-10" />
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold text-foreground pointer-events-none">
          {t('contacts.title')}
        </h1>
        <button
          onClick={handleAdd}
          className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
          aria-label={t('contacts.addContact')}
        >
          <Plus className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
      </header>

      {/* Search */}
      {contacts.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-background-card border border-border">
            <Search className="w-4 h-4 text-foreground-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.search')}
              className="flex-1 bg-transparent text-body focus:outline-none placeholder:text-foreground-muted"
            />
          </div>
        </div>
      )}

      {/* Contact List */}
      <div className="flex-1 overflow-y-auto pb-app-nav">
        {contacts.length === 0 ? (
          <EmptyState
            icon={<BookUser className="w-7 h-7" />}
            title={t('contacts.emptyTitle')}
            description={t('contacts.emptyDescription')}
            action={{ label: t('contacts.addContact'), onClick: handleAdd }}
          />
        ) : filtered.length === 0 ? (
          <p className="text-center text-body text-foreground-muted py-12">
            {t('contacts.noResults')}
          </p>
        ) : (
          <div className="bg-background-card">
            {filtered.map((contact) => {
              const Icon = addressTypeIcon[contact.addressType]
              const isExpanded = expandedId === contact.id
              const isSending = sendingId === contact.id
              return (
                <div key={contact.id} className="border-b border-border/40 last:border-b-0">
                  {/* Contact row */}
                  <button
                    onClick={() => handleToggle(contact.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-foreground/[0.02] transition-colors"
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${contact.addressType === 'lightning' ? 'bg-amber-500' : contact.addressType === 'npub' ? 'bg-purple-500' : 'bg-foreground-muted'}`}>
                      <Icon className="w-[18px] h-[18px] text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-medium text-foreground truncate">{contact.name}</p>
                      <p className="text-caption text-foreground-muted truncate">{contact.address}</p>
                    </div>
                  </button>

                  {/* Accordion actions */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-center gap-2 px-4 pb-3">
                          <button
                            onClick={() => handleSend(contact)}
                            disabled={isSending}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-card bg-brand text-white text-caption font-semibold active:opacity-80 transition-opacity disabled:opacity-40"
                          >
                            {isSending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            )}
                            {t('common.send')}
                          </button>
                          <button
                            onClick={() => handleEdit(contact)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-card bg-foreground/[0.06] text-foreground text-caption font-semibold active:opacity-80 transition-opacity"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {t('contacts.editContact')}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(contact)}
                            className="flex items-center justify-center w-10 h-10 rounded-card bg-foreground/[0.06] active:opacity-80 transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-accent-danger" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Form Modal */}
      <ContactFormModal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingContact(null) }}
        onSave={handleSave}
        contact={editingContact}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={deleteTarget?.name || ''}
        description={t('contacts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="destructive"
      />

      {/* Mint Select — after address validation */}
      <MintSelectBottomSheet
        isOpen={!!pendingSend}
        onClose={() => setPendingSend(null)}
        onSelect={(mintUrl) => {
          if (pendingSend) {
            onSendToContact?.(pendingSend.data, pendingSend.name, mintUrl)
            setPendingSend(null)
          }
        }}
        selectedMintUrl={null}
        filterFn={pendingSend?.commonMintUrls
          ? (mint) => pendingSend.commonMintUrls!.some((url) => url.replace(/\/+$/, '').toLowerCase() === mint.url.replace(/\/+$/, '').toLowerCase())
          : undefined}
      />
    </div>
  )
}

export default ContactsScreen
