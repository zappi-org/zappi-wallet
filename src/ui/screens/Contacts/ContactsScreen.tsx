import { detectAddressType } from '@/core/types/contact'
import { chatOpenErrorKey } from '@/ui/screens/Chat/chat-address'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'
import { ContactActionsSheet } from './ContactActionsSheet'
import { ContactFavorites } from './ContactFavorites'
import { useState, useCallback, useMemo } from 'react'
import { Plus, Search, Star } from 'lucide-react'
import { IdentificationIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/ui/components/common/EmptyState'
import { ConfirmDialog } from '@/ui/components/common/ConfirmDialog'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { ContactFormModal } from './ContactFormModal'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import type { ValidatedData } from '@/core/domain/input-types'
import {
  resolveSendRoute,
  resolveDirectPaymentOrLookupFailure,
  SEND_ROUTE_ERROR_I18N,
} from '@/core/domain/send-route-resolution'
import { useAppStore } from '@/store'
import { isSameMintUrl } from '@/utils/url'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { Contact } from '@/core/types'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { ContactAddressIcon } from '@/ui/components/payment/RecipientEndpointIcon'


export interface ContactsScreenProps {
  onChatWithContact?: (address: string) => Promise<void>
  /** Called with validated data + contact name + selected mint when send is confirmed */
  onSendToContact?: (
    validatedData: ValidatedData,
    displayName: string,
    mintUrl: string
  ) => void
}

export function ContactsScreen({
  onSendToContact,
  onChatWithContact,
}: ContactsScreenProps) {
  const { t } = useTranslation()
  const top = useIsActivityTop()
  const addToast = useAppStore((s) => s.addToast)
  const settings = useAppStore((s) => s.settings)
  const inputParser = useInputParser()
  const { nostrDirectPayment } = useServiceRegistry()
  const {
    contacts,
    toggleFavorite,
    createContact,
    updateContact,
    deleteContact: deleteContactById,
  } = useContacts()
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null)
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null
  )
  const selectedContact =
    contacts.find((contact) => contact.id === selectedContactId) ?? null
  const [pendingSend, setPendingSend] = useState<{
    data: ValidatedData
    name: string
    commonMintUrls?: string[]
  } | null>(null)

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return contacts
    const q = searchQuery.toLowerCase()
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q)
    )
  }, [contacts, searchQuery])

  const handleSave = useCallback(
    async (data: { name: string; address: string }) => {
      const addressType = detectAddressType(data.address)
      if (editingContact) {
        await updateContact(editingContact.id, { ...data, addressType })
      } else {
        await createContact({ ...data, addressType })
      }
      setEditingContact(null)
    },
    [editingContact, createContact, updateContact]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteContactById(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      addToast({ type: 'error', message: t('chat.saveFailed') })
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleting, deleteContactById, addToast, t])

  const handleEdit = useCallback((contact: Contact) => {
    setEditingContact(contact)
    setShowForm(true)
  }, [])

  const handleAdd = useCallback(() => {
    setEditingContact(null)
    setShowForm(true)
  }, [])

  const handleSend = useCallback(
    async (contact: Contact) => {
      if (!onSendToContact || !contact.address) return
      try {
        if (contact.addressType === 'npub') {
          // Map lookup failures to the same payment-route error.
          const resolution = await resolveDirectPaymentOrLookupFailure(() =>
            nostrDirectPayment.resolve({
              address: contact.address,
              ownMintUrls: settings.mints,
              selectedMintUrl: null,
            })
          )

          const decision = resolveSendRoute(resolution)

          switch (decision.kind) {
            case 'advance':
            case 'needs-mint-selection':
              setPendingSend({
                data: decision.data,
                name: contact.name,
                commonMintUrls: decision.commonMintUrls,
              })
              return
            case 'error':
              addToast({
                type: 'error',
                message: t(SEND_ROUTE_ERROR_I18N[decision.error]),
                duration: 3000,
              })
              return
          }
        }

        const detected = inputParser.detectAndClassify(contact.address)
        if (detected.type === 'unknown') {
          addToast({
            type: 'error',
            message: t('send.destination.unrecognized'),
            duration: 3000,
          })
          return
        }
        try {
          const validated = await inputParser.validateAsync(detected)

          if (validated.type === 'email-address' && validated.nutzapInfo) {
            const resolution = nostrDirectPayment.resolveWithInfo({
              address: validated.address,
              pubkey: validated.nutzapInfo.pubkey,
              directToken: validated.nutzapInfo,
              ownMintUrls: settings.mints,
              selectedMintUrl: null,
            })

            const decision = resolveSendRoute(resolution, validated)

            switch (decision.kind) {
              case 'advance':
              case 'needs-mint-selection':
                setPendingSend({
                  data: decision.data,
                  name: contact.name,
                  commonMintUrls: decision.commonMintUrls,
                })
                return
              case 'lnurl-fallback':
                break
              case 'error':
                addToast({
                  type: 'error',
                  message: t(SEND_ROUTE_ERROR_I18N[decision.error]),
                  duration: 3000,
                })
                return
            }
          }

          // An address with neither ecash info nor LNURL pay has no usable route —
          // fail here instead of on the send screen at an unavailable fee.
          if (validated.type === 'email-address' && !validated.lnurlParams) {
            addToast({
              type: 'error',
              message: t('send.destination.validationFailed'),
              duration: 3000,
            })
            return
          }

          setPendingSend({ data: validated, name: contact.name })
        } catch (err) {
          addToast({
            type: 'error',
            message:
              err instanceof Error
                ? err.message
                : t('send.destination.unrecognized'),
            duration: 3000,
          })
        }
      } catch (error) {
        addToast({
          type: 'error',
          message:
            error instanceof Error ? error.message : t('chat.saveFailed'),
        })
      }
    },
    [
      onSendToContact,
      addToast,
      t,
      inputParser,
      settings.mints,
      nostrDirectPayment,
    ]
  )

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
          <Plus
            className="w-[22px] h-[22px] text-foreground"
            strokeWidth={1.8}
          />
        </button>
      </header>

      {/* Contact List */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-app-nav">
        <ContactFavorites
          contacts={contacts}
          hidden={!!searchQuery}
          onSelect={setSelectedContactId}
        />
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
                className="flex-1 min-w-0 bg-transparent text-base focus:outline-none placeholder:text-foreground-muted"
              />
            </div>
          </div>
        )}

        {contacts.length === 0 ? (
          <EmptyState
            icon={<IdentificationIcon className="w-7 h-7" />}
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
            {filtered.map((contact) => (
              <button
                key={contact.id}
                onClick={() => setSelectedContactId(contact.id)}
                aria-haspopup="dialog"
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-border/40 last:border-b-0 active:bg-foreground/[0.02] transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                  <ContactAddressIcon type={contact.addressType} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium truncate">
                    {contact.name}
                  </p>
                  <p className="text-caption text-foreground-muted truncate">
                    {contact.address}
                  </p>
                </div>
                {contact.favorite && (
                  <Star
                    size={14}
                    className="shrink-0 text-brand"
                    fill="currentColor"
                    aria-label={t('chat.favorites')}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <ContactActionsSheet
        contact={selectedContact}
        onClose={() => setSelectedContactId(null)}
        onChat={
          selectedContact &&
          (selectedContact.address.startsWith('npub1') ||
            selectedContact.address.startsWith('nprofile1')) &&
          onChatWithContact
            ? () => {
                const address = selectedContact.address
                setSelectedContactId(null)
                void onChatWithContact(address).catch((error) =>
                  addToast({
                    type: 'error',
                    message: t(chatOpenErrorKey(error)),
                  })
                )
              }
            : undefined
        }
        onSend={
          selectedContact?.address && onSendToContact
            ? () => {
                setSelectedContactId(null)
                void handleSend(selectedContact)
              }
            : undefined
        }
        onEdit={() => {
          if (selectedContact) {
            setSelectedContactId(null)
            handleEdit(selectedContact)
          }
        }}
        onToggleFavorite={async () => {
          if (!selectedContact) return
          try {
            await toggleFavorite(selectedContact)
          } catch {
            addToast({ type: 'error', message: t('chat.saveFailed') })
          }
        }}
        onDelete={() => {
          if (selectedContact) {
            setDeleteTarget(selectedContact)
            setSelectedContactId(null)
          }
        }}
      />

      {/* Form Modal */}
      <ContactFormModal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingContact(null)
        }}
        onSave={handleSave}
        contact={editingContact}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget && top}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        loading={deleting}
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
        filterFn={
          pendingSend?.commonMintUrls
            ? (mint) =>
                pendingSend.commonMintUrls!.some((url) =>
                  isSameMintUrl(url, mint.url)
                )
            : undefined
        }
      />
    </div>
  )
}

export default ContactsScreen
