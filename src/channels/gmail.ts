import { ImapFlow } from 'imapflow'
import { simpleParser, AddressObject } from 'mailparser'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import fs from 'fs'
import path from 'path'
import { Channel, ChannelMessage, ChannelAttachment, Reply } from './types.js'

const SCRATCH = path.resolve('scratch')
const MAX_ATTACH = Number(process.env.ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024)
// v1 default mailbox (override via GMAIL_USER env). App password is never
// defaulted — it must come from GMAIL_APP_PASSWORD env, no fallback.
const DEFAULT_GMAIL_USER = 'yeexianteoh1223@gmail.com'
const ALLOWED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/octet-stream', // some clients mislabel xlsx; filename check below
]

function addrList(a?: AddressObject | AddressObject[]): string[] {
  if (!a) return []
  const arr = Array.isArray(a) ? a : [a]
  return arr.flatMap(x => x.value.map(v => v.address ?? ''))
}

export class GmailChannel implements Channel {
  name = 'gmail'
  private client: ImapFlow | null = null
  private user: string
  private pass: string

  constructor() {
    this.user = process.env.GMAIL_USER || DEFAULT_GMAIL_USER
    this.pass = process.env.GMAIL_APP_PASSWORD ?? ''
  }

  get selfAddress() {
    return this.user.toLowerCase()
  }

  isConfigured() {
    return Boolean(this.user && this.pass)
  }

  private makeClient() {
    return new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.user, pass: this.pass },
      logger: false,
    })
  }

  async connect() {
    if (this.client) return
    this.client = this.makeClient()
    await this.client.connect()
  }

  async disconnect() {
    if (!this.client) return
    await this.client.logout().catch(() => {})
    this.client = null
  }

  // Reconnect-per-poll keeps things simple and survives dropped IMAP sockets.
  private async withConnection<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.makeClient()
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.logout().catch(() => {})
    }
  }

  // limit = max number of MOST RECENT unread messages to fetch+parse.
  // Without this, mailboxes with thousands of promo/marketing unread blow up
  // tool output and crash the LLM context.
  async fetchUnread(limit = 20): Promise<ChannelMessage[]> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const allUids = await client.search({ seen: false })
        if (!allUids || allUids.length === 0) return []
        // UIDs are monotonically increasing — newest = largest. Take last N.
        const uids = [...allUids].sort((a, b) => a - b).slice(-limit)

        const messages: ChannelMessage[] = []
        for await (const raw of client.fetch(uids, { uid: true, source: true })) {
          if (!raw.source) continue
          const parsed = await simpleParser(raw.source)

          const fromAddr = parsed.from?.value?.[0]
          const attachments: ChannelAttachment[] = []

          for (const att of parsed.attachments ?? []) {
            const filename = att.filename ?? 'unnamed'
            const isSheet =
              ALLOWED_TYPES.includes(att.contentType) ||
              /\.(xlsx|csv)$/i.test(filename)
            if (!isSheet) continue
            if (att.size > MAX_ATTACH) continue

            // download to scratch immediately (content already in memory from parser)
            const dir = path.join(SCRATCH, 'inbound', String(raw.uid))
            fs.mkdirSync(dir, { recursive: true })
            const localPath = path.join(dir, filename.replace(/[^\w.\-]/g, '_'))
            fs.writeFileSync(localPath, att.content)

            attachments.push({
              filename,
              mimeType: att.contentType,
              sizeBytes: att.size,
              localPath,
            })
          }

          messages.push({
            id: parsed.messageId ?? `uid-${raw.uid}`,
            channel: 'gmail',
            threadId: parsed.inReplyTo ?? parsed.messageId ?? `uid-${raw.uid}`,
            from: { name: fromAddr?.name ?? '', address: (fromAddr?.address ?? '').toLowerCase() },
            to: addrList(parsed.to),
            subject: parsed.subject ?? '',
            body: (parsed.text ?? '').trim(),
            attachments,
            receivedAt: parsed.date?.getTime() ?? Date.now(),
            references: parsed.references
              ? Array.isArray(parsed.references) ? parsed.references : [parsed.references]
              : [],
          })
        }
        return messages
      } finally {
        lock.release()
      }
    })
  }

  async createDraft(reply: Reply): Promise<void> {
    const attachments = (reply.attachmentPaths ?? []).map(p => ({
      filename: path.basename(p),
      path: p,
    }))

    const mail = new MailComposer({
      from: `Deep Agent (assistant) <${this.user}>`,
      to: reply.to,
      subject: reply.subject,
      text: reply.body,
      inReplyTo: reply.inReplyTo,
      references: reply.references?.join(' '),
      attachments,
    })

    const raw: Buffer = await new Promise((resolve, reject) =>
      mail.compile().build((err, msg) => (err ? reject(err) : resolve(msg)))
    )

    await this.withConnection(async client => {
      await client.append('[Gmail]/Drafts', raw, ['\\Draft'])
    })
  }

  async markRead(messageId: string): Promise<void> {
    await this.withConnection(async client => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = await client.search({ header: { 'message-id': messageId } })
        if (uids && uids.length > 0) {
          await client.messageFlagsAdd(uids, ['\\Seen'], { uid: false })
        }
      } finally {
        lock.release()
      }
    })
  }
}

export const gmailChannel = new GmailChannel()
