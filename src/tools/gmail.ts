// Gmail tools — wrap the GmailChannel. NOTE: there is deliberately NO
// gmail_send tool in v1. Draft-only is enforced by absence of capability.

import { Tool, ToolResult } from '../core/types.js'
import { gmailChannel } from '../channels/gmail.js'

export const gmailListTool: Tool = {
  name: 'gmail_list_unread',
  description:
    'List the most-recent unread emails in the inbox: sender, subject, short snippet, attachment filenames. Default limit 20, max 50.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Max results (default 20, capped at 50)' },
    },
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
          limit,
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

export const gmailCreateDraftTool: Tool = {
  name: 'gmail_create_draft',
  description:
    'Create a reply DRAFT in Gmail (never sends — a human reviews and sends). Provide to-address, subject, body text, and optionally attachment file paths and the message-id being replied to.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string' },
      body: { type: 'string', description: 'Plain-text body of the draft' },
      inReplyTo: { type: 'string', description: 'Message-ID this replies to (keeps it in-thread)' },
      attachmentPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute file paths to attach (e.g. generated chart png)',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      await gmailChannel.createDraft({
        to: String(input.to),
        subject: String(input.subject),
        body: String(input.body),
        inReplyTo: input.inReplyTo ? String(input.inReplyTo) : undefined,
        references: input.inReplyTo ? [String(input.inReplyTo)] : undefined,
        attachmentPaths: Array.isArray(input.attachmentPaths)
          ? input.attachmentPaths.map(String)
          : undefined,
        mode: 'draft',
      })
      return { success: true, output: 'Draft created in Gmail. A human must review and send it.' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailMarkReadTool: Tool = {
  name: 'gmail_mark_read',
  description: 'Mark an email as read (handled) by its message-id.',
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
