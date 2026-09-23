# Private messages

Chat shares the wallet's Nostr identity and gateway. One npub/nprofile supports
chat and the existing validated payment flow. Local chat storage uses a separate
encryption key; Cashu storage encryption is outside this feature.

## Architecture

- `ChatUseCase` exposes snapshots, durable enqueue, retry and conversation actions.
- `ChatService` owns delivery, read state and lifecycle; it imports only core types.
- `ChatTransport` authenticates wire messages and prepares stable message IDs.
- `ChatRepository` owns persistence, encryption, quotas and replay protection.
- Composition wires implementations; UI consumes driving ports.

NIP-17 kind-14 rumors travel in NIP-59 gift wraps. The adapter verifies outer/seal
signatures, rumor author/hash, destination and timestamp. Token envelopes and
support-ticket DMs remain in their existing payment/support handlers.

Recipient inbox discovery accepts verified kind-10050 records or explicit nprofile
hints. A verified empty inbox overrides old hints; sender relays are not substituted
for an unknown recipient inbox. Query timeout is 3 seconds; publish has an 8-second
native deadline and 12-second outer deadline. First recipient relay ACK succeeds;
best-effort sender backup does not block it. ACK means relay acceptance, not receipt.

Enqueue returns after local persistence. Up to three deliveries run independently.
Reconnect rebuilds pending jobs without duplicating in-flight jobs or automatically
retrying failures. Snapshot-refresh failure does not turn a saved enqueue into a
failed save. Retries preserve message IDs; metadata corruption fails before publish.

## Storage and lock

DB version 27 includes scoped message keys, quota accounting and wrapped storage
keys. Account + channel + optional context + peer identify a conversation. Message
IDs and replay records are scoped to that conversation.

Each account has a random 256-bit AES-GCM data key, wrapped by a distinct HKDF-SHA256
key derived from the unlocked BIP39 seed. The wallet password already protects that
seed, so password changes need no separate chat-key rewrite. The Nostr private key
is not reused as a storage key. Each encrypted field has a fresh 96-bit IV and AAD
binding its version, account, record and field.

Message bodies, previews, drafts and local payment links are encrypted. Routing
metadata (peer IDs, timestamps, sizes, statuses and replay IDs) remains readable.
Contacts and customer-support storage are unchanged. Unlocked-origin XSS, weak
password guessing and forensic remnants of old database pages are not solved here.

Concurrent initializers use one committed wrapped key. Missing keys with existing
ciphertext, bad authentication and unknown formats fail closed. Legacy plaintext
rows migrate in atomic batches, including orphan records; interruption is resumable.
Legacy primary-key migration rolls back on failure rather than dropping wallet data.

Lock revokes the storage key, clears plaintext caches/snapshots and stops chat
subscriptions. Generation guards reject stale async results. The shared wallet
gateway retains its pre-existing lifecycle; this does not guarantee erasure of all
wallet-key references on screen lock. Unlock completes migration before chat starts.
Chat initialization failure leaves the wallet usable. Logout clears the chat tables.

Limits per account: 10,000 messages, 16 MiB of body bytes, 1,000 active conversations
and 100,000 replay IDs. Checks and writes share a transaction. Limits reject writes;
they never silently discard history. Deleting conversations releases quota.
The receive queue is bounded at 512 events and reports overload for retry.

Deletion is local. A permanent clear cutoff survives reopening and prevents old
replays restoring deleted history. Favorites, drafts, mute/block/pin state and read
counts are device-local. New messages may reopen a deleted conversation.

## Payments

Chat's send action validates the known npub and opens the existing SendFlow amount
step, selecting a compatible mint when needed. Chat requests use ReceiveFlow to
create and persist an invoice/NUT-18 request, then enqueue its card directly without
a QR screen. Failed storage/sharing retries reuse the same request; ordinary wallet
QR flows are unchanged. Received request cards open the prefilled payment confirmation.

Cards follow [KakaoPay's chat entry pattern](https://contents.kakaopay.com/contents/2325):
participant name, amount, status, request expiry and transaction details. A sent but
unclaimed token is distinguished from a payment still processing. No unsupported receive-approval
or cancellation semantics are invented. An encrypted local link points to the same
transaction ID used by mint history; the card creates no duplicate transaction.

A payment notice alone does not establish receipt. New Nostr notices carry the
actual delivery event ID. Receipt lookup requires a local incoming transaction
plus verified delivery ID, sender, recipient and gross amount. Approval and
offline-recovery paths preserve this binding and map to their local transaction ID.
Legacy notices without a binding remain unconfirmed; amounts/timestamps are never
used to guess a match. Only local wallet records establish settlement. Notices omit tokens and mint URLs. Own request cards look up
existing receive-request state through its payment-method reference.

Known submitted requests cannot be paid again while status lookup is pending or
unavailable. Chat completion returns to the conversation on the actual wallet result without
awaiting notice persistence or the final receipt animation. If notice persistence
fails after submission, the real payment result is retained and the user is directed to history. A session marker still blocks a
repeat action, but cannot survive restart if no link could be persisted. This is
not an exactly-once guarantee for manually paying a request again.

## UI and navigation

The conversation is a visual-viewport-sized flex column; only the transcript scrolls.
The viewport hook handles iOS focus pan, document locking, safe areas and delayed
keyboard resizes, then restores styles/listeners on exit. Sending and the +/× action toggle preserve an already focused composer; neither
toggle opens a closed keyboard. Safari touch handling prevents duplicate clicks.
IME composition never sends. New-chat/contact forms use the same viewport handling.

Message motion uses measured composer geometry and one clipped transcript layer,
following [Telegram's iOS transition](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/TelegramUI/Sources/ChatMessageTransitionNode.swift).
Read/status/draft changes do not scroll or reanimate history. Touch interrupts motion;
reduced motion removes movement. Older-page insertion preserves the reading anchor. Initial positioning waits for
the conversation DOM; content-height observation keeps the bottom pinned when
receipt details load later, without moving a reader who scrolled up.
Persisted drafts hydrate before writes, and save failure preserves the next draft.

The centered header has contact actions, mute, block and delete. Pinning belongs to
the list. Destructive actions confirm; covered screens hide their dialogs. Favorites
and regular contacts share an action sheet. The chat QR shares the same wallet identity.
Unread counts cap at 99+. Visible-app message toasts show the contact name and a
40-character preview with ellipsis; payment payloads use short labels. Lock removes
chat previews immediately. Manual mark-as-read is removed; opening a conversation
still marks messages read. Tabs are Wallet, Contacts, Chat, Settings.

Stackflow restore sanitization drops invalid navigation state. Wallet navigation can
replace a restored Messages root when Home is absent, avoiding a stuck tab.

## Mostro boundary and remaining work

[Mostro chat](https://mostro.network/protocol/chat.html) uses a different wire format
and order-specific keys. A future adapter must own its key/authentication policy.
The transport account is the stable local owner; logical participant identity can
be separate. Channel/context namespaces keep different orders with one peer distinct.
Non-direct conversations default to no wallet payment/contact/deletion/block actions.

Runtime channel registration, reserved trade-history quotas, bounded relay catch-up,
dispute/evidence UI and actual Mostro interoperability remain future work. This is
not a Mostro client. Large loaded histories are not fully virtualized.

The separate-chat-identity experiment was reverted for one-address UX. Development
history is preserved; old-key pending messages are rejected rather than re-signed.
Old contact rows prefer the primary address, retaining legacy data as a fallback.
Automatically binding independent public keys would require an explicit exchange
protocol; arbitrary keys cannot safely be matched by inference.

## Verification

Specialist reviews cover core/storage security, lifecycle, UI, payments and test
quality. Regressions use real Nostr crypto, Web Crypto and IndexedDB behavior with
controlled transports. They cover tampering, account/context isolation, quota races,
migration rollback/resume, lock races, outbox recovery, drafts, scroll and payment links.

Local mobile browser fixtures verify layout without real user keys, funds or messages.
Earlier iPhone simulator checks verified keyboard opening/sending/restoration, but
simulated drags did not deliver genuine touchmove events. Physical iPhone performance
and live external-client interoperability remain separate checks. Passing tests is
not an external security certification.


Chat payment UX verification: the payment transport now signs one gift wrap and
publishes that same event to all recipient relays, completing on the first ACK.
Payment publications use an 8-second timeout; relay connection attempts are bounded
at 5 seconds. Other publication callers retain their existing behavior. No automatic
payment retry was added. No ACK is not proof of non-delivery; existing rollback and
transaction-history handling remain responsible for uncertain failures.

Real request rendering is tested with the codec's actual uppercase CREQB output,
not a mock lowercase token. Shared case-insensitive classification covers cards
and list previews without modifying the case-sensitive payment payload. Legacy
creqA remains supported.

Request expiry travels in an authenticated, encrypted inner-rumor tag named
zappi-request-expiration; the raw CREQ remains interoperable. Expired cards remain
in history, lose their action live, and are checked again before final execution.
Malformed/duplicate expiry tags and altered rumor IDs are rejected.

Incoming request cards select a configured source mint before entering SendFlow.
A sufficiently funded compatible mint is preferred, then other funded sources;
fee and total-balance checks still run normally. Cold chat entry no longer reaches
the fee screen with a missing source. Repeated instructional copy was removed;
short status labels distinguish an unverified notice from a confirmed receipt.
Only sender-written request memos appear as card descriptions.

Current validation: 228 test files / 1,991 tests, lint, production build and
dependency checks passed. Independent specialists reviewed receive durability,
same-operation recovery and authenticated receipt matching. A mobile browser
fixture measured zero bottom gap after delayed receipt rendering and preserved
the reader position after content growth. No real funds were sent during testing.


## Incoming payment recovery

The watcher stores the recoverable token before marking an event processed.
Subscription cursors advance only after durable handlers succeed, so local write
failures do not permanently hide relay events. Unknown-mint reviews remain durable.

Automatic Nostr receipts checkpoint the Coco receive-operation ID before execution.
Retries use that same operation and verify its mint, unit and input proof identity.
If Coco recovered a finalized operation before rethrowing an error, its verified
final state is accepted. Spent inputs alone never prove this wallet received funds.
Transient failures remain active for the existing 120-second sweep; unlock/resume
performs an immediate recovery check. Invalid/rolled-back operations are terminal.
Concurrent calls are gated before the first storage read. Existing terminal failures
without a checkpoint are not blindly retried as fresh payments.

Approved and recovered tokens are linked only after their actual settled receipt
matches the original token, mint and gross amount (including receive-fee handling).
Incoming failures retain the receive direction in wallet history.


Request and payment cards stay separate in the timeline. Requests retain their
original title, amount and memo; paying creates an outgoing payment notice. Incoming
receipts are shown only after the verified local wallet transaction confirms them.
No receive button or additional receive operation is introduced.

Incoming request cards keep their Send action. A submitted request opens an
already-sent acknowledgement instead of another payment. The launch and final
execution both check local payment links and wallet transactions; concurrent calls
for the same request are gated. A session marker also blocks retries when saving
the payment notice fails. This is not cross-device idempotency, and deleting the
local linkage or reloading after a failed notice save can lose that protection.

Verified request-to-transaction associations remain available internally. Incoming
associations require the actual receive record's request ID to match the decoded
CREQ ID; a sender's reference alone is insufficient. One transaction cannot complete
several requests. Receipt details open the existing wallet transaction.

An iOS 26.3 iPhone simulator Home Screen PWA check previously verified +/× toggling
with the software keyboard open, plus toggling without opening a closed keyboard.
No real funds were used.
