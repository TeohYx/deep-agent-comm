import { ImapFlow } from 'imapflow'
import { simpleParser, AddressObject, ParsedMail } from 'mailparser'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import fs from 'fs'
import path from 'path'
import { Channel, ChannelMessage, ChannelAttachment, Reply } from './types.js'

const SCRATCH = path.resolve('scratch')
const MAX_ATTACH = Number(process.env.ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024)
// v1 default mailbox (override via GMAIL_USER env). App password is never
// defaulted — it must come from GMAIL_APP_PASSWORD env, no fallback.
const DEFAULT_GMAIL_USER = 'yeexianteoh1223@gmail.com'
const ALL_MAIL = '[Gmail]/All Mail'
const DRAFTS = '[Gmail]/Drafts'
const TRASH = '[Gmail]/Trash'
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

export interface DraftSummary {
  uid: number
  subject: string
  to: string[]
  date: string
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
    await this.getConnectedClient()
  }

  async disconnect() {
    if (!this.client) return
    await this.client.logout().catch(() => {})
    this.client = null
  }

  // Reuse ONE long-lived authenticated connection. Gmail throttles repeated
  // IMAP logins (observed ~47s stalls when reconnecting per op), so we keep the
  // socket open and only reconnect if it dropped. ImapFlow's getMailboxLock
  // serializes concurrent ops on the shared client.
  private connecting: Promise<ImapFlow> | null = null

  private async getConnectedClient(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client
    if (this.connecting) return this.connecting

    this.connecting = (async () => {
      const client = this.makeClient()
      client.on('error', () => { this.client = null })
      client.on('close', () => { this.client = null })
      await client.connect()
      this.client = client
      return client
    })()

    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  // Run an op on the shared connection. One retry if the socket was stale.
  private async withConnection<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.getConnectedClient())
    } catch (e) {
      if (this.client && !this.client.usable) {
        this.client = null
        return await fn(await this.getConnectedClient())
      }
      throw e
    }
  }

  // Convert a parsed mail into the normalized ChannelMessage. downloadAttachments
  // controls whether .xlsx/.csv bodies are written to scratch (only needed for
  // inbound processing, not for search/list previews).
  private toChannelMessage(parsed: ParsedMail, uid: number, downloadAttachments: boolean): ChannelMessage {
    const fromAddr = parsed.from?.value?.[0]
    const attachments: ChannelAttachment[] = []

    for (const att of parsed.attachments ?? []) {
      const filename = att.filename ?? 'unnamed'
      const isSheet =
        ALLOWED_TYPES.includes(att.contentType) || /\.(xlsx|csv)$/i.test(filename)

      const meta: ChannelAttachment = {
        filename,
        mimeType: att.contentType,
        sizeBytes: att.size,
      }

      if (downloadAttachments && isSheet && att.size <= MAX_ATTACH) {
        const dir = path.join(SCRATCH, 'inbound', String(uid))
        fs.mkdirSync(dir, { recursive: true })
        const localPath = path.join(dir, filename.replace(/[^\w.\-]/g, '_'))
        fs.writeFileSync(localPath, att.content)
        meta.localPath = localPath
      }
      attachments.push(meta)
    }

    return {
      id: parsed.messageId ?? `uid-${uid}`,
      channel: 'gmail',
      threadId: parsed.inReplyTo ?? parsed.messageId ?? `uid-${uid}`,
      from: { name: fromAddr?.name ?? '', address: (fromAddr?.address ?? '').toLowerCase() },
      to: addrList(parsed.to),
      subject: parsed.subject ?? '',
      body: (parsed.text ?? '').trim(),
      attachments,
      receivedAt: parsed.date?.getTime() ?? Date.now(),
      references: parsed.references
        ? Array.isArray(parsed.references) ? parsed.references : [parsed.references]
        : [],
    }
  }

  // ── 1. READ / QUERY ────────────────────────────────────────────────

  // limit = max number of MOST RECENT unread messages to fetch+parse.
  async fetchUnread(limit = 20): Promise<ChannelMessage[]> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const allUids = await client.search({ seen: false })
        if (!allUids || allUids.length === 0) return []
        const uids = [...allUids].sort((a, b) => a - b).slice(-limit)
        const messages: ChannelMessage[] = []
        for await (const raw of client.fetch(uids, { uid: true, source: true })) {
          if (!raw.source) continue
          messages.push(this.toChannelMessage(await simpleParser(raw.source), raw.uid, true))
        }
        return messages
      } finally {
        lock.release()
      }
    })
  }

  // Full Gmail search syntax via the X-GM-RAW IMAP extension.
  // e.g. "from:boss@x.com is:unread newer_than:2d has:attachment"
  async search(gmailQuery: string, limit = 20, mailbox = ALL_MAIL): Promise<ChannelMessage[]> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock(mailbox)
      try {
        // imapflow passes { gmailRaw } straight to Gmail's X-GM-RAW.
        const seqs = await client.search({ gmailRaw: gmailQuery } as any)
        if (!seqs || seqs.length === 0) return []
        const picked = [...seqs].sort((a, b) => a - b).slice(-limit)
        const messages: ChannelMessage[] = []
        for await (const raw of client.fetch(picked, { uid: true, source: true })) {
          if (!raw.source) continue
          messages.push(this.toChannelMessage(await simpleParser(raw.source), raw.uid, false))
        }
        return messages.sort((a, b) => b.receivedAt - a.receivedAt)
      } finally {
        lock.release()
      }
    })
  }

  // Find one message by its Message-ID. Searches All Mail so it works for
  // sent/archived mail too. downloadAttachments=true to materialize sheets.
  async getMessage(messageId: string, downloadAttachments = false): Promise<ChannelMessage | null> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock(ALL_MAIL)
      try {
        const seqs = await client.search({ header: { 'message-id': messageId } })
        if (!seqs || seqs.length === 0) return null
        for await (const raw of client.fetch([seqs[seqs.length - 1]], { uid: true, source: true })) {
          if (!raw.source) continue
          return this.toChannelMessage(await simpleParser(raw.source), raw.uid, downloadAttachments)
        }
        return null
      } finally {
        lock.release()
      }
    })
  }

  // Reconstruct a thread from RFC 5322 References/In-Reply-To headers
  // (protocol-correct, no Gmail API needed). Returns messages oldest→newest.
  async getThread(messageId: string): Promise<ChannelMessage[]> {
    const root = await this.getMessage(messageId, false)
    if (!root) return []
    const ids = new Set<string>([messageId, ...(root.references ?? [])])
    const out: ChannelMessage[] = []
    for (const id of ids) {
      const m = id === messageId ? root : await this.getMessage(id, false).catch(() => null)
      if (m) out.push(m)
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt)
  }

  // ── 2. WRITE (DRAFTS ONLY — no send in v1) ─────────────────────────

  async createDraft(reply: Reply): Promise<void> {
    const attachments = (reply.attachmentPaths ?? []).map(p => ({
      filename: path.basename(p),
      path: p,
    }))

    const mail = new MailComposer({
      from: `Deep Agent (assistant) <${this.user}>`,
      to: reply.to,
      cc: reply.cc?.join(', '),
      bcc: reply.bcc?.join(', '),
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
      await client.append(DRAFTS, raw, ['\\Draft'])
    })
  }

  // Forward an existing message as a NEW draft (carries original body + sheet attachments).
  async createForwardDraft(messageId: string, to: string, note: string): Promise<void> {
    const orig = await this.getMessage(messageId, true)
    if (!orig) throw new Error(`Message not found: ${messageId}`)

    const quoted =
      `${note ? note + '\n\n' : ''}---------- Forwarded message ----------\n` +
      `From: ${orig.from.name} <${orig.from.address}>\n` +
      `Date: ${new Date(orig.receivedAt).toISOString()}\n` +
      `Subject: ${orig.subject}\n\n${orig.body}`

    await this.createDraft({
      to,
      subject: `Fwd: ${orig.subject}`,
      body: quoted,
      attachmentPaths: orig.attachments.map(a => a.localPath).filter((p): p is string => Boolean(p)),
      mode: 'draft',
    })
  }

  async listDrafts(limit = 20): Promise<DraftSummary[]> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock(DRAFTS)
      try {
        const seqs = await client.search({ all: true })
        if (!seqs || seqs.length === 0) return []
        const picked = [...seqs].sort((a, b) => a - b).slice(-limit)
        const drafts: DraftSummary[] = []
        for await (const raw of client.fetch(picked, { uid: true, envelope: true })) {
          drafts.push({
            uid: raw.uid,
            subject: raw.envelope?.subject ?? '(no subject)',
            to: (raw.envelope?.to ?? []).map(t => t.address ?? ''),
            date: raw.envelope?.date?.toISOString() ?? '',
          })
        }
        return drafts.reverse()
      } finally {
        lock.release()
      }
    })
  }

  async deleteDraft(uid: number): Promise<void> {
    await this.withConnection(async client => {
      const lock = await client.getMailboxLock(DRAFTS)
      try {
        await client.messageDelete([uid], { uid: true })
      } finally {
        lock.release()
      }
    })
  }

  // ── 3. ORGANIZE ────────────────────────────────────────────────────

  // Toggle an IMAP flag on a message (by Message-ID) in INBOX.
  // Gmail maps \Seen↔read, \Flagged↔star.
  private async setFlag(messageId: string, flag: string, add: boolean): Promise<boolean> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const seqs = await client.search({ header: { 'message-id': messageId } })
        if (!seqs || seqs.length === 0) return false
        if (add) await client.messageFlagsAdd(seqs, [flag])
        else await client.messageFlagsRemove(seqs, [flag])
        return true
      } finally {
        lock.release()
      }
    })
  }

  async markRead(messageId: string): Promise<void> {
    await this.setFlag(messageId, '\\Seen', true)
  }
  async markUnread(messageId: string): Promise<void> {
    await this.setFlag(messageId, '\\Seen', false)
  }
  async star(messageId: string): Promise<void> {
    await this.setFlag(messageId, '\\Flagged', true)
  }
  async unstar(messageId: string): Promise<void> {
    await this.setFlag(messageId, '\\Flagged', false)
  }

  // Move a message (by Message-ID) out of INBOX. Archive = → All Mail, Trash = → Trash.
  private async moveFromInbox(messageId: string, dest: string): Promise<boolean> {
    return this.withConnection(async client => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const seqs = await client.search({ header: { 'message-id': messageId } })
        if (!seqs || seqs.length === 0) return false
        await client.messageMove(seqs, dest)
        return true
      } finally {
        lock.release()
      }
    })
  }

  async archive(messageId: string): Promise<void> {
    await this.moveFromInbox(messageId, ALL_MAIL)
  }
  async trash(messageId: string): Promise<void> {
    await this.moveFromInbox(messageId, TRASH)
  }
}

// L0 transport: migrated from IMAP (GmailChannel above, kept for reference) to
// the Gmail API (OAuth). The IMAP class remains importable but is no longer the
// active singleton. Swap back by changing this one line if ever needed.
import { GmailApiChannel } from './gmail-api.js'
export const gmailChannel = new GmailApiChannel()
