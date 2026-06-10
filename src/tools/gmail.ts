// Gmail tools — wrap GmailChannel (IMAP). Grouped by functional area per
// docs/gmail_channel_functionality.md. NOTE: there is deliberately NO gmail_send
// tool in v1 — draft-only is enforced by absence of capability. Settings/Sync
// areas (filters, vacation, Pub/Sub, History API) are Gmail-API-only and out of
// scope for the IMAP transport (see the doc's implementation-status section).

import { Tool, ToolResult } from '../core/types.js'
import { gmailChannel } from '../channels/gmail.js'

// ── 1. READ / QUERY ──────────────────────────────────────────────────

export const gmailListTool: Tool = {
  name: 'gmail_list_unread',
  description:
    'List the most-recent UNREAD emails in the inbox (narrow: unread only). For anything else — date ranges, a sender, starred, attachments — use gmail_search instead. Default limit 20, max 50.',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', description: 'Max results (default 20, capped at 50)' } },
    required: [],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const limit = Math.min(Math.max(Number(input.limit ?? 20) || 20, 1), 50)
      const msgs = await gmailChannel.fetchUnread(limit)
      return {
        success: true,
        output: {
          count: msgs.length,
          messages: msgs.map(m => ({
            id: m.id,
            from: m.from.address,
            subject: (m.subject ?? '').slice(0, 120),
            snippet: m.body.slice(0, 120).replace(/\s+/g, ' '),
            attachments: m.attachments.map(a => a.filename),
            receivedAt: new Date(m.receivedAt).toISOString(),
          })),
        },
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailSearchTool: Tool = {
  name: 'gmail_search',
  description:
    'Search mail using full Gmail query syntax (the real abstraction). Supports from:, to:, subject:, label:, has:attachment, is:unread, is:starred, newer_than:2d, after:2026/06/01, before:, in:inbox, etc. Use this for "emails today", "from X", "with attachments", anything beyond plain unread. Default limit 20, max 50.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query, e.g. "from:boss@x.com newer_than:7d has:attachment"' },
      limit: { type: 'integer', description: 'Max results (default 20, capped at 50)' },
    },
    required: ['query'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const limit = Math.min(Math.max(Number(input.limit ?? 20) || 20, 1), 50)
      const msgs = await gmailChannel.search(String(input.query), limit)
      return {
        success: true,
        output: {
          query: String(input.query),
          count: msgs.length,
          messages: msgs.map(m => ({
            id: m.id,
            from: m.from.address,
            subject: (m.subject ?? '').slice(0, 120),
            snippet: m.body.slice(0, 120).replace(/\s+/g, ' '),
            attachments: m.attachments.map(a => a.filename),
            receivedAt: new Date(m.receivedAt).toISOString(),
          })),
        },
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailGetMessageTool: Tool = {
  name: 'gmail_get_message',
  description:
    'Get the full content of one email by its Message-ID: headers, full body text, and attachment metadata. Set download=true to materialize .xlsx/.csv attachments to disk and get their file paths (for charting/analysis).',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'The Message-ID (from a list/search result id field)' },
      download: { type: 'boolean', description: 'Download .xlsx/.csv attachments to disk (default false)' },
    },
    required: ['messageId'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const m = await gmailChannel.getMessage(String(input.messageId), Boolean(input.download))
      if (!m) return { success: false, output: null, error: 'Message not found' }
      return {
        success: true,
        output: {
          id: m.id,
          from: m.from,
          to: m.to,
          subject: m.subject,
          body: m.body.slice(0, 6000),
          bodyHtml: m.bodyHtml ? m.bodyHtml.slice(0, 6000) : null,
          receivedAt: new Date(m.receivedAt).toISOString(),
          attachments: m.attachments.map(a => ({
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            localPath: a.localPath ?? null,
          })),
        },
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailGetThreadTool: Tool = {
  name: 'gmail_get_thread',
  description:
    'Get a whole conversation thread (ordered oldest→newest) given any Message-ID in it. Reconstructed from References headers. Use to get full context before drafting a reply.',
  inputSchema: {
    type: 'object',
    properties: { messageId: { type: 'string' } },
    required: ['messageId'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const thread = await gmailChannel.getThread(String(input.messageId))
      if (thread.length === 0) return { success: false, output: null, error: 'Thread not found' }
      return {
        success: true,
        output: {
          count: thread.length,
          messages: thread.map(m => ({
            id: m.id,
            from: m.from.address,
            subject: m.subject,
            body: m.body.slice(0, 3000),
            receivedAt: new Date(m.receivedAt).toISOString(),
          })),
        },
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

// ── 2. WRITE (DRAFTS ONLY) ───────────────────────────────────────────

export const gmailCreateDraftTool: Tool = {
  name: 'gmail_create_draft',
  description:
    'Create a reply or new DRAFT in Gmail (never sends — a human reviews and sends). For reply-all, pass the other recipients in cc. Pass the original Message-ID as inReplyTo to keep it in-thread.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      cc: { type: 'array', items: { type: 'string' }, description: 'CC addresses (use for reply-all)' },
      bcc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      body: { type: 'string', description: 'Plain-text body' },
      inReplyTo: { type: 'string', description: 'Message-ID this replies to (keeps it in-thread)' },
      attachmentPaths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to attach' },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      await gmailChannel.createDraft({
        to: String(input.to),
        cc: Array.isArray(input.cc) ? input.cc.map(String) : undefined,
        bcc: Array.isArray(input.bcc) ? input.bcc.map(String) : undefined,
        subject: String(input.subject),
        body: String(input.body),
        inReplyTo: input.inReplyTo ? String(input.inReplyTo) : undefined,
        references: input.inReplyTo ? [String(input.inReplyTo)] : undefined,
        attachmentPaths: Array.isArray(input.attachmentPaths) ? input.attachmentPaths.map(String) : undefined,
        mode: 'draft',
      })
      return { success: true, output: 'Draft created in Gmail. A human must review and send it.' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailForwardDraftTool: Tool = {
  name: 'gmail_forward_draft',
  description:
    'Create a FORWARD draft of an existing message (carries the original body + .xlsx/.csv attachments). Never sends.',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'Message-ID to forward' },
      to: { type: 'string', description: 'Recipient' },
      note: { type: 'string', description: 'Optional note to prepend above the forwarded content' },
    },
    required: ['messageId', 'to'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      await gmailChannel.createForwardDraft(String(input.messageId), String(input.to), String(input.note ?? ''))
      return { success: true, output: 'Forward draft created. A human must review and send it.' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailListDraftsTool: Tool = {
  name: 'gmail_list_drafts',
  description: 'List existing drafts (uid, subject, recipients, date). Use the uid to delete a draft.',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', description: 'Max results (default 20)' } },
    required: [],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const limit = Math.min(Math.max(Number(input.limit ?? 20) || 20, 1), 50)
      const drafts = await gmailChannel.listDrafts(limit)
      return { success: true, output: { count: drafts.length, drafts } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailDeleteDraftTool: Tool = {
  name: 'gmail_delete_draft',
  description: 'Delete a draft by its id (get the id from gmail_list_drafts).',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      await gmailChannel.deleteDraft(String(input.id))
      return { success: true, output: 'Draft deleted.' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

// ── 3. ORGANIZE ──────────────────────────────────────────────────────

export const gmailOrganizeTool: Tool = {
  name: 'gmail_organize',
  description:
    'Organize a message by Message-ID. action: mark_read | mark_unread | star | unstar | mark_important | unmark_important | archive (remove from inbox) | trash | restore (untrash).',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string' },
      action: {
        type: 'string',
        enum: ['mark_read', 'mark_unread', 'star', 'unstar', 'mark_important', 'unmark_important', 'archive', 'trash', 'restore'],
      },
    },
    required: ['messageId', 'action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const id = String(input.messageId)
      switch (String(input.action)) {
        case 'mark_read': await gmailChannel.markRead(id); break
        case 'mark_unread': await gmailChannel.markUnread(id); break
        case 'star': await gmailChannel.star(id); break
        case 'unstar': await gmailChannel.unstar(id); break
        case 'mark_important': await gmailChannel.markImportant(id); break
        case 'unmark_important': await gmailChannel.unmarkImportant(id); break
        case 'archive': await gmailChannel.archive(id); break
        case 'trash': await gmailChannel.trash(id); break
        case 'restore': await gmailChannel.restore(id); break
        default: return { success: false, output: null, error: `Unknown action: ${input.action}` }
      }
      return { success: true, output: `Done: ${input.action}` }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

// ── Attachments / drafts / labels / sync (gmail.modify scope) ────────

export const gmailGetAttachmentTool: Tool = {
  name: 'gmail_get_attachment',
  description:
    'Download a specific attachment (any type) from a message to disk by filename. Returns the local file path. (For .xlsx/.csv you can also use gmail_get_message download=true.)',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string' },
      filename: { type: 'string', description: 'Attachment filename (or a substring of it)' },
    },
    required: ['messageId', 'filename'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const p = await gmailChannel.getAttachment(String(input.messageId), String(input.filename))
      return { success: true, output: { filePath: p } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailUpdateDraftTool: Tool = {
  name: 'gmail_update_draft',
  description: 'Update an existing draft in place by its id (replaces its content). Get the id from gmail_list_drafts.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Draft id' },
      to: { type: 'string' },
      cc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      body: { type: 'string' },
      attachmentPaths: { type: 'array', items: { type: 'string' } },
    },
    required: ['id', 'to', 'subject', 'body'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      await gmailChannel.updateDraft(String(input.id), {
        to: String(input.to),
        cc: Array.isArray(input.cc) ? input.cc.map(String) : undefined,
        subject: String(input.subject),
        body: String(input.body),
        attachmentPaths: Array.isArray(input.attachmentPaths) ? input.attachmentPaths.map(String) : undefined,
        mode: 'draft',
      })
      return { success: true, output: 'Draft updated.' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailLabelTool: Tool = {
  name: 'gmail_label',
  description:
    'Apply or remove a Gmail label on a message by name. action: apply | remove. Applying a non-existent label creates it first.',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: { type: 'string' },
      label: { type: 'string', description: 'Label name, e.g. "Follow-up"' },
      action: { type: 'string', enum: ['apply', 'remove'] },
    },
    required: ['messageId', 'label', 'action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const id = String(input.messageId)
      const label = String(input.label)
      if (String(input.action) === 'apply') await gmailChannel.applyLabel(id, label)
      else await gmailChannel.removeLabel(id, label)
      return { success: true, output: `${input.action} label "${label}"` }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailManageLabelsTool: Tool = {
  name: 'gmail_manage_labels',
  description: 'Manage the label list itself. action: list | create | delete (name required for create/delete).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'delete'] },
      name: { type: 'string' },
    },
    required: ['action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const action = String(input.action)
      if (action === 'list') {
        const labels = await gmailChannel.listLabels()
        return { success: true, output: { labels: labels.map(l => l.name) } }
      }
      if (!input.name) return { success: false, output: null, error: 'name required' }
      if (action === 'create') {
        const l = await gmailChannel.createLabel(String(input.name))
        return { success: true, output: { created: l.name } }
      }
      await gmailChannel.deleteLabel(String(input.name))
      return { success: true, output: { deleted: String(input.name) } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailHistoryTool: Tool = {
  name: 'gmail_history',
  description:
    'Incremental sync: list message changes (added/removed ids) since a historyId. Call with no arg to get the current historyId cursor to start from.',
  inputSchema: {
    type: 'object',
    properties: { startHistoryId: { type: 'string', description: 'Cursor from a prior call; omit to get the current cursor' } },
    required: [],
  },
  async execute(input): Promise<ToolResult> {
    try {
      if (!input.startHistoryId) {
        const historyId = await gmailChannel.currentHistoryId()
        return { success: true, output: { currentHistoryId: historyId, note: 'Pass this as startHistoryId next time to get changes since now.' } }
      }
      const res = await gmailChannel.history(String(input.startHistoryId))
      return { success: true, output: res }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailWatchTool: Tool = {
  name: 'gmail_watch',
  description:
    'Start Gmail push notifications (Pub/Sub) on the INBOX. Requires a Cloud Pub/Sub topic — pass topicName like "projects/<proj>/topics/<topic>" or set GMAIL_PUBSUB_TOPIC env. action: start | stop.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'stop'] },
      topicName: { type: 'string' },
    },
    required: ['action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      if (String(input.action) === 'stop') {
        await gmailChannel.stopWatch()
        return { success: true, output: 'watch stopped' }
      }
      const topic = String(input.topicName ?? process.env.GMAIL_PUBSUB_TOPIC ?? '')
      if (!topic) return { success: false, output: null, error: 'No Pub/Sub topic. Pass topicName or set GMAIL_PUBSUB_TOPIC.' }
      const res = await gmailChannel.watch(topic)
      return { success: true, output: res }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

// Back-compat: existing skills/triggers reference gmail_mark_read.
export const gmailMarkReadTool: Tool = {
  name: 'gmail_mark_read',
  description: 'Mark an email as read (handled) by its Message-ID. (Shortcut for gmail_organize action=mark_read.)',
  inputSchema: {
    type: 'object',
    properties: { messageId: { type: 'string' } },
    required: ['messageId'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      await gmailChannel.markRead(String(input.messageId))
      return { success: true, output: 'marked read' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

// Convenience export: every core Gmail tool (gmail.modify scope), for one-line registration.
export const gmailTools: Tool[] = [
  gmailListTool,
  gmailSearchTool,
  gmailGetMessageTool,
  gmailGetThreadTool,
  gmailGetAttachmentTool,
  gmailCreateDraftTool,
  gmailForwardDraftTool,
  gmailListDraftsTool,
  gmailDeleteDraftTool,
  gmailUpdateDraftTool,
  gmailOrganizeTool,
  gmailLabelTool,
  gmailManageLabelsTool,
  gmailHistoryTool,
  gmailWatchTool,
  gmailMarkReadTool,
]
