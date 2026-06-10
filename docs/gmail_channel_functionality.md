# Gmail Communication Channel — Standard Functionality

A complete Gmail-based communication channel covers six functional areas. Gaps in any area cause silent capability mismatches (e.g. "show me today's emails" answered by an unread-only tool).

## 1. Read / Query

| Capability | Description |
|---|---|
| Search with query string | Full Gmail syntax: `from:`, `to:`, `subject:`, `label:`, `has:attachment`, `is:unread`, `is:starred`, `newer_than:`, `after:`, `before:`, `in:inbox` |
| Get message by ID | Full headers + plain text + HTML body |
| Get thread | Ordered conversation, not just single message |
| List attachments | Metadata for a message |
| Download attachment | Binary fetch by attachment ID |

## 2. Write / Send

| Capability | Description |
|---|---|
| Compose new | To / CC / BCC, subject, body (plain + HTML) |
| Reply | Preserves threading via `In-Reply-To` and `References` headers |
| Reply-all | Same threading; populates all recipients |
| Forward | Carries original body + attachments |
| Attachments | Upload files of various sizes (chunked for large) |
| Inline images | CID-referenced images in HTML body |
| Send-as alias | Send from a configured alias address |
| Drafts | Create, list, update, delete, send — first-class objects |

## 3. Organize

| Capability | Description |
|---|---|
| Apply / remove label | Labels are Gmail's folders |
| Create / delete label | Manage label hierarchy |
| Mark read / unread | Toggle `UNREAD` system label |
| Star / unstar | Toggle `STARRED` |
| Mark important | Toggle `IMPORTANT` |
| Archive | Remove `INBOX` label |
| Trash / restore / permanent delete | Three distinct states |

## 4. Sync / Notify

| Capability | Description |
|---|---|
| History API | Incremental change tracking — avoids refetching full mailbox |
| Pub/Sub watch | Push notifications on new mail or thread changes |
| Last-sync cursor | Persist `historyId` between polls |

## 5. Settings / Automation

| Capability | Description |
|---|---|
| Signatures | Per-alias signature management |
| Vacation auto-responder | Enable / disable / set message and date range |
| Send-as addresses | Configure aliases the account can send from |
| Filters / rules | Create, list, delete server-side filters |
| Forwarding | Manage forwarding addresses |
| IMAP / POP | Toggle protocol access |
| Delegated access | Manage delegates on the account |

## 6. Auth & Operational Basics

| Capability | Description |
|---|---|
| OAuth scopes | Least-privilege: read-only vs modify vs send vs full |
| Token refresh | Handle expiry transparently |
| Batch requests | Efficiency for bulk operations |
| Rate limits | Respect per-user and per-project quotas |
| Idempotency on send | Don't double-send on network retry |
| Error surfaces | Quota exceeded, invalid recipient, attachment too large, rate-limited |

## Design Principles

| Principle | Why it matters |
|---|---|
| Operate on threads, not just messages | Users think in conversations; threading headers corrupt easily |
| Expose raw query string | Gmail's query language is the real abstraction — pre-canned filters always leave gaps |
| Read + write parity | An integration that reads but can't reply, or vice versa, is rarely useful end-to-end |
| Honest tool scope | A `list_unread` tool should not be used to answer "emails today" — narrow tools should advertise their narrowness |
