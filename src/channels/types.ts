// L0 — Channel layer contracts. Every channel (gmail, teams, slack...)
// normalizes inbound mail to `Message` and accepts `Reply` for outbound.

export interface ChannelMessage {
  id: string                  // globally unique (Message-ID for email)
  channel: 'gmail' | 'teams' | 'slack' | 'web'
  threadId: string
  from: { name: string; address: string }
  to: string[]
  subject?: string
  body: string                // plain text, cleaned
  attachments: ChannelAttachment[]
  receivedAt: number
  references?: string[]       // email threading headers
}

export interface ChannelAttachment {
  filename: string
  mimeType: string
  sizeBytes: number
  localPath?: string          // set after download to scratch dir
}

export interface Reply {
  to: string
  subject: string
  body: string
  inReplyTo?: string          // Message-ID being replied to
  references?: string[]
  attachmentPaths?: string[]
  mode: 'draft'               // v1: draft ONLY. 'send' does not exist.
}

export interface Channel {
  name: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  fetchUnread(): Promise<ChannelMessage[]>
  createDraft(reply: Reply): Promise<void>
  markRead(messageId: string): Promise<void>
}
