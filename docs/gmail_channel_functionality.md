# Gmail Communication Channel — Standard Functionality

A complete Gmail-based communication channel covers six functional areas. Gaps in any area cause silent capability mismatches (e.g. "show me today's emails" answered by an unread-only tool).

> **Implementation status:** **MIGRATED to the Gmail REST API (OAuth2)** as of 2026-06-10. The transport was originally IMAP + app password; it is now `GmailApiChannel` (`src/channels/gmail-api.ts`), a drop-in L0 swap. The IMAP class (`GmailChannel`) is kept dormant for reference. Scope granted: `gmail.modify`.
>
> What the migration changed vs. the IMAP tables below: **Sync/Notify and Settings/Automation are no longer structurally impossible** — they become buildable on Gmail API (not yet built, but reachable). Threads are now **native** (`threadId`, not References reconstruction). The IMAP throttling/latency problem is **gone** (connect ~0.6s, ops 1–2.5s, vs IMAP's 15–47s). Legend: ✅ built · ◐ partial · ⭕ now possible on Gmail API, not yet built · 🚫 intentionally withheld (guardrail).
>
> **Implemented tools (22):**
> *Read:* `gmail_search`, `gmail_list_unread`, `gmail_get_message`, `gmail_get_thread`, `gmail_get_attachment`.
> *Write (drafts):* `gmail_create_draft`, `gmail_forward_draft`, `gmail_update_draft`, `gmail_list_drafts`, `gmail_delete_draft`.
> *Organize:* `gmail_organize` (mark_read/unread, star/unstar, mark_important/unmark_important, archive, trash, restore), `gmail_label`, `gmail_manage_labels`, `gmail_mark_read` (shortcut).
> *Sync:* `gmail_history`, `gmail_watch`.
> *Settings (need re-consent):* `gmail_filters`, `gmail_vacation`, `gmail_sendas`, `gmail_forwarding`, `gmail_imap_pop`, `gmail_delegates`.
> Auth bootstrap: `src/channels/gmail-oauth.ts` (scopes: `gmail.modify` + `gmail.settings.basic` + `gmail.settings.sharing`).

## 1. Read / Query

| Capability | Description | Status | Tool |
|---|---|---|---|
| Search with query string | Full Gmail syntax: `from:`, `to:`, `subject:`, `label:`, `has:attachment`, `is:unread`, `is:starred`, `newer_than:`, `after:`, `before:`, `in:inbox` | ✅ via IMAP `X-GM-RAW` | `gmail_search` |
| List unread | Narrow: most-recent unread only | ✅ | `gmail_list_unread` |
| Get message by ID | Full headers + plain text **+ HTML body** + attachment metadata | ✅ | `gmail_get_message` |
| Get thread | Ordered conversation, not just single message | ✅ native `threadId` | `gmail_get_thread` |
| List attachments | Metadata for a message | ✅ (in `gmail_get_message`) | `gmail_get_message` |
| Download attachment | Binary fetch — **any type** | ✅ | `gmail_get_attachment` (or `gmail_get_message` `download=true` for sheets) |

## 2. Write / Send

> **Guardrail:** v1 is **draft-only**. No `gmail_send` tool exists anywhere — the send capability is withheld by absence, not by prompt (decision `answer-for-md.md` #3/#4). Every "write" below produces a Gmail draft a human reviews and sends.

| Capability | Description | Status | Tool |
|---|---|---|---|
| Compose new | To / CC / BCC, subject, body (plain) | ✅ (plain text) | `gmail_create_draft` |
| Reply | Preserves threading via `In-Reply-To` / `References` | ✅ | `gmail_create_draft` (pass `inReplyTo`) |
| Reply-all | Same threading; all recipients | ✅ | `gmail_create_draft` (pass `cc[]`) |
| Forward | Carries original body + .xlsx/.csv attachments | ✅ | `gmail_forward_draft` |
| Attachments | Attach files | ✅ | `gmail_create_draft` (`attachmentPaths[]`) |
| Inline images | CID-referenced images in HTML body | 🔲 (plain-text compose; low priority) | — |
| Send-as alias config | Manage alias + signature (config, not sending) | ✅ (needs settings scope) | `gmail_sendas` |
| Drafts: create | First-class draft object | ✅ | `gmail_create_draft` |
| Drafts: list | | ✅ | `gmail_list_drafts` |
| Drafts: delete | | ✅ | `gmail_delete_draft` |
| Drafts: update | In-place edit | ✅ native `drafts.update` | `gmail_update_draft` |
| Drafts: send | | 🚫 withheld (draft-only guardrail) | — |

## 3. Organize

| Capability | Description | Status | Tool |
|---|---|---|---|
| Mark read / unread | Toggle `UNREAD` label | ✅ | `gmail_organize` (mark_read / mark_unread) |
| Star / unstar | Toggle `STARRED` | ✅ | `gmail_organize` (star / unstar) |
| Mark important | Toggle `IMPORTANT` | ✅ | `gmail_organize` (mark_important / unmark_important) |
| Archive | Remove `INBOX` label | ✅ | `gmail_organize` (archive) |
| Trash | Move to Trash | ✅ | `gmail_organize` (trash) |
| Restore | Untrash | ✅ | `gmail_organize` (restore) |
| Apply / remove label | Add/remove a label by name (auto-creates on apply) | ✅ | `gmail_label` |
| Create / delete / list label | Manage the label list | ✅ | `gmail_manage_labels` |
| Permanent delete | Purge a message | 🚫 withheld (destructive — not exposed) | — |

## 4. Sync / Notify

> **Now reachable on Gmail API** (was impossible on IMAP). Not yet built — current trigger is still a 60s poll with Message-ID dedupe (`triggers/email.ts`, decision `02-triggers` #1). These are the natural next upgrades.

| Capability | Description | Status | Tool |
|---|---|---|---|
| History API | Incremental change tracking — added/removed ids since a cursor | ✅ | `gmail_history` |
| Last-sync cursor | Get current `historyId` to start from | ✅ | `gmail_history` (no-arg call) |
| Pub/Sub watch | Push notifications on new mail | ◐ built, needs a Cloud Pub/Sub topic (`GMAIL_PUBSUB_TOPIC`) | `gmail_watch` |

## 5. Settings / Automation

> **BUILT** (`src/tools/gmail-settings.ts`). These need the `gmail.settings.basic` + `gmail.settings.sharing` scopes — now in the bootstrap. **Re-run `npx tsx src/channels/gmail-oauth.ts` once** to re-consent with the new scopes before these execute.

| Capability | Description | Status | Tool |
|---|---|---|---|
| Filters / rules | List / create / delete server-side filters | ✅ | `gmail_filters` |
| Vacation auto-responder | Get / set responder + date range | ✅ | `gmail_vacation` |
| Signatures | Update per-alias signature | ✅ | `gmail_sendas` (update_signature) |
| Send-as addresses | List aliases | ✅ | `gmail_sendas` (list) |
| Forwarding | List forwarding addresses | ✅ (read) | `gmail_forwarding` |
| IMAP / POP | Get/toggle protocol access | ✅ | `gmail_imap_pop` |
| Delegated access | List delegates | ◐ tool built, but **Workspace-only** — personal Gmail returns "restricted to domain-wide authority" | `gmail_delegates` |

## 6. Auth & Operational Basics

| Capability | Description | Status |
|---|---|---|
| OAuth scopes | `gmail.modify` + `settings.basic` + `settings.sharing` (no send scope) | ✅ |
| Token refresh | Refresh token stored; access tokens auto-refresh via google-auth-library | ✅ |
| Batch requests | Bulk efficiency | 🔲 (sequential gets in v1; fine at current volume) |
| Rate limits | Per-user/project quotas | ◐ no throttling like IMAP; no explicit backoff tool yet |
| Idempotency | No send → no double-send risk; inbound deduped by Gmail message id | ✅ |
| Error surfaces | Tool results return `{success:false, error}`; scope errors surface verbatim | ✅ |

## ~~Known limitation — IMAP latency / throttling~~ (RESOLVED by Gmail API migration)

This was the decisive reason to migrate. Over IMAP, Gmail throttled the account after many connections — every command took ~5s (login/SELECT ~15s) instead of <500ms. Measured after migration: connect ~0.6s, search ~2.4s, fetchUnread ~2s, native getThread ~1.2s. The Gmail REST API has no per-connection login cost, so the problem is gone. (Historical note retained; the IMAP `GmailChannel` is kept dormant in `src/channels/gmail.ts` only for reference.)

## Design Principles

| Principle | Why it matters |
|---|---|
| Operate on threads, not just messages | Users think in conversations; threading headers corrupt easily |
| Expose raw query string | Gmail's query language is the real abstraction — pre-canned filters always leave gaps |
| Read + write parity | An integration that reads but can't reply, or vice versa, is rarely useful end-to-end |
| Honest tool scope | A `list_unread` tool should not be used to answer "emails today" — narrow tools should advertise their narrowness |
