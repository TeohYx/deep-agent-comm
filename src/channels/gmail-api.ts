// L0 — Gmail API channel (OAuth). Drop-in replacement for the IMAP channel:
// implements the same surface the tools/triggers call. No IMAP throttling,
// native threads (threadId), native labels.
//
// ChannelMessage.id = Gmail's internal message id (stable, unique) — used for
// get/organize/dedup. RFC Message-ID + threadId are resolved internally when
// threading a reply draft.

import { google, gmail_v1 } from 'googleapis'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import fs from 'fs'
import path from 'path'
import { Channel, ChannelMessage, ChannelAttachment, Reply } from './types.js'

const SCRATCH = path.resolve('scratch')
const MAX_ATTACH = Number(process.env.ATTACHMENT_MAX_BYTES ?? 10 * 1024 * 1024)
const DEFAULT_GMAIL_USER = 'yeexianteoh1223@gmail.com'
const CLIENT_SECRET_PATH = path.resolve('secrets/google_oauth_client.json')
const TOKEN_PATH = path.resolve('secrets/gmail.token.json')
const ALLOWED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/octet-stream',
]

export interface DraftSummary {
  id: string          // Gmail draft id
  subject: string
  to: string[]
  date: string
}

export class GmailApiChannel implements Channel {
  name = 'gmail'
  private user: string
  private client: gmail_v1.Gmail | null = null

  constructor() {
    this.user = process.env.GMAIL_USER || DEFAULT_GMAIL_USER
  }

  get selfAddress() {
    return this.user.toLowerCase()
  }

  isConfigured() {
    return fs.existsSync(CLIENT_SECRET_PATH) && fs.existsSync(TOKEN_PATH)
  }

  private auth() {
    const secret = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'))
    const cfg = secret.installed ?? secret.web
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
    const oauth = new google.auth.OAuth2(cfg.client_id, cfg.client_secret)
    oauth.setCredentials({ refresh_token: token.refresh_token })
    return oauth
  }

  private gmail(): gmail_v1.Gmail {
    if (this.client) return this.client
    if (!this.isConfigured()) {
      throw new Error('Gmail API not authorized. Run: npx tsx src/channels/gmail-oauth.ts')
    }
    this.client = google.gmail({ version: 'v1', auth: this.auth() })
    return this.client
  }

  async connect() {
    await this.gmail().users.getProfile({ userId: 'me' })
  }
  async disconnect() {
    this.client = null
  }

  // ── helpers ────────────────────────────────────────────────────────

  private header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
    const h = (headers ?? []).find(x => (x.name ?? '').toLowerCase() === name.toLowerCase())
    return h?.value ?? ''
  }

  private parseFrom(raw: string): { name: string; address: string } {
    const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/)
    if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() }
    return { name: '', address: raw.trim().toLowerCase() }
  }

  // Recursively collect plain-text + HTML body + attachment parts.
  private walk(
    part: gmail_v1.Schema$MessagePart | undefined,
    acc: { text: string; html: string; atts: gmail_v1.Schema$MessagePart[] }
  ) {
    if (!part) return
    const mime = part.mimeType ?? ''
    if (part.filename && part.body?.attachmentId) {
      acc.atts.push(part)
    } else if (mime === 'text/plain' && part.body?.data) {
      acc.text += Buffer.from(part.body.data, 'base64url').toString('utf8')
    } else if (mime === 'text/html' && part.body?.data) {
      acc.html += Buffer.from(part.body.data, 'base64url').toString('utf8')
    }
    for (const child of part.parts ?? []) this.walk(child, acc)
  }

  private async fetchMessage(id: string, download: boolean): Promise<ChannelMessage> {
    const gmail = this.gmail()
    const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const msg = res.data
    const headers = msg.payload?.headers
    const acc = { text: '', html: '', atts: [] as gmail_v1.Schema$MessagePart[] }
    this.walk(msg.payload, acc)

    const attachments: ChannelAttachment[] = []
    for (const part of acc.atts) {
      const filename = part.filename ?? 'unnamed'
      const mimeType = part.mimeType ?? 'application/octet-stream'
      const sizeBytes = Number(part.body?.size ?? 0)
      const meta: ChannelAttachment = { filename, mimeType, sizeBytes }

      const isSheet = ALLOWED_TYPES.includes(mimeType) || /\.(xlsx|csv)$/i.test(filename)
      if (download && isSheet && sizeBytes <= MAX_ATTACH && part.body?.attachmentId) {
        const att = await gmail.users.messages.attachments.get({
          userId: 'me', messageId: id, id: part.body.attachmentId,
        })
        const dir = path.join(SCRATCH, 'inbound', id)
        fs.mkdirSync(dir, { recursive: true })
        const localPath = path.join(dir, filename.replace(/[^\w.\-]/g, '_'))
        fs.writeFileSync(localPath, Buffer.from(att.data.data ?? '', 'base64url'))
        meta.localPath = localPath
      }
      attachments.push(meta)
    }

    const refs = this.header(headers, 'References')
    return {
      id: msg.id ?? id,
      channel: 'gmail',
      threadId: msg.threadId ?? id,
      from: this.parseFrom(this.header(headers, 'From')),
      to: this.header(headers, 'To').split(',').map(s => s.trim()).filter(Boolean),
      subject: this.header(headers, 'Subject'),
      body: (acc.text || msg.snippet || '').trim(),
      bodyHtml: acc.html || undefined,
      attachments,
      receivedAt: Number(msg.internalDate ?? Date.now()),
      references: refs ? refs.split(/\s+/).filter(Boolean) : [],
    }
  }

  // Light preview (no body/attachment download) for list/search results.
  private async previewMessage(id: string): Promise<ChannelMessage> {
    const res = await this.gmail().users.messages.get({
      userId: 'me', id, format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date'],
    })
    const msg = res.data
    const headers = msg.payload?.headers
    // attachment filenames live in payload parts; metadata format omits bodies
    // but keeps part structure with filenames.
    const atts: string[] = []
    const collect = (p?: gmail_v1.Schema$MessagePart) => {
      if (!p) return
      if (p.filename) atts.push(p.filename)
      for (const c of p.parts ?? []) collect(c)
    }
    collect(msg.payload)
    return {
      id: msg.id ?? id,
      channel: 'gmail',
      threadId: msg.threadId ?? id,
      from: this.parseFrom(this.header(headers, 'From')),
      to: this.header(headers, 'To').split(',').map(s => s.trim()).filter(Boolean),
      subject: this.header(headers, 'Subject'),
      body: (msg.snippet ?? '').trim(),
      attachments: atts.filter(Boolean).map(f => ({ filename: f, mimeType: '', sizeBytes: 0 })),
      receivedAt: Number(msg.internalDate ?? Date.now()),
      references: [],
    }
  }

  // ── 1. READ / QUERY ────────────────────────────────────────────────

  async fetchUnread(limit = 20): Promise<ChannelMessage[]> {
    const list = await this.gmail().users.messages.list({
      userId: 'me', q: 'is:unread in:inbox', maxResults: limit,
    })
    const ids = (list.data.messages ?? []).map(m => m.id!).filter(Boolean)
    const out: ChannelMessage[] = []
    for (const id of ids) out.push(await this.fetchMessage(id, true))   // download sheets for processing
    return out
  }

  async search(query: string, limit = 20): Promise<ChannelMessage[]> {
    const list = await this.gmail().users.messages.list({ userId: 'me', q: query, maxResults: limit })
    const ids = (list.data.messages ?? []).map(m => m.id!).filter(Boolean)
    const out: ChannelMessage[] = []
    for (const id of ids) out.push(await this.previewMessage(id))
    return out.sort((a, b) => b.receivedAt - a.receivedAt)
  }

  async getMessage(messageId: string, download = false): Promise<ChannelMessage | null> {
    try {
      return await this.fetchMessage(messageId, download)
    } catch {
      return null
    }
  }

  async getThread(messageId: string): Promise<ChannelMessage[]> {
    const meta = await this.gmail().users.messages.get({
      userId: 'me', id: messageId, format: 'metadata', metadataHeaders: [],
    })
    const threadId = meta.data.threadId
    if (!threadId) return []
    const thread = await this.gmail().users.threads.get({ userId: 'me', id: threadId, format: 'full' })
    const msgs = thread.data.messages ?? []
    const out: ChannelMessage[] = []
    for (const m of msgs) if (m.id) out.push(await this.fetchMessage(m.id, false))
    return out.sort((a, b) => a.receivedAt - b.receivedAt)
  }

  // ── 2. WRITE (DRAFTS ONLY) ─────────────────────────────────────────

  private async buildRaw(reply: Reply, extraHeaders?: Record<string, string>): Promise<string> {
    const attachments = (reply.attachmentPaths ?? []).map(p => ({ filename: path.basename(p), path: p }))
    const mail = new MailComposer({
      from: `Deep Agent (assistant) <${this.user}>`,
      to: reply.to,
      cc: reply.cc?.join(', '),
      bcc: reply.bcc?.join(', '),
      subject: reply.subject,
      text: reply.body,
      attachments,
      ...(extraHeaders ? { headers: extraHeaders } : {}),
    })
    const buf: Buffer = await new Promise((resolve, reject) =>
      mail.compile().build((err, msg) => (err ? reject(err) : resolve(msg)))
    )
    return buf.toString('base64url')
  }

  async createDraft(reply: Reply): Promise<void> {
    let threadId: string | undefined
    const extraHeaders: Record<string, string> = {}

    // Resolve threading from the original message (reply.inReplyTo = Gmail id).
    if (reply.inReplyTo) {
      try {
        const orig = await this.gmail().users.messages.get({
          userId: 'me', id: reply.inReplyTo, format: 'metadata',
          metadataHeaders: ['Message-ID', 'References'],
        })
        threadId = orig.data.threadId ?? undefined
        const rfcId = this.header(orig.data.payload?.headers, 'Message-ID')
        const refs = this.header(orig.data.payload?.headers, 'References')
        if (rfcId) {
          extraHeaders['In-Reply-To'] = rfcId
          extraHeaders['References'] = [refs, rfcId].filter(Boolean).join(' ')
        }
      } catch {
        /* original not found — create a non-threaded draft */
      }
    }

    const raw = await this.buildRaw(reply, Object.keys(extraHeaders).length ? extraHeaders : undefined)
    await this.gmail().users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw, threadId } },
    })
  }

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
    const list = await this.gmail().users.drafts.list({ userId: 'me', maxResults: limit })
    const out: DraftSummary[] = []
    for (const d of list.data.drafts ?? []) {
      if (!d.id || !d.message?.id) continue
      const meta = await this.gmail().users.messages.get({
        userId: 'me', id: d.message.id, format: 'metadata', metadataHeaders: ['To', 'Subject', 'Date'],
      })
      out.push({
        id: d.id,
        subject: this.header(meta.data.payload?.headers, 'Subject') || '(no subject)',
        to: this.header(meta.data.payload?.headers, 'To').split(',').map(s => s.trim()).filter(Boolean),
        date: this.header(meta.data.payload?.headers, 'Date'),
      })
    }
    return out
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.gmail().users.drafts.delete({ userId: 'me', id: draftId })
  }

  // ── 3. ORGANIZE ────────────────────────────────────────────────────

  private async modify(messageId: string, add: string[], remove: string[]): Promise<void> {
    await this.gmail().users.messages.modify({
      userId: 'me', id: messageId,
      requestBody: { addLabelIds: add, removeLabelIds: remove },
    })
  }

  async markRead(messageId: string) { await this.modify(messageId, [], ['UNREAD']) }
  async markUnread(messageId: string) { await this.modify(messageId, ['UNREAD'], []) }
  async star(messageId: string) { await this.modify(messageId, ['STARRED'], []) }
  async unstar(messageId: string) { await this.modify(messageId, [], ['STARRED']) }
  async archive(messageId: string) { await this.modify(messageId, [], ['INBOX']) }
  async markImportant(messageId: string) { await this.modify(messageId, ['IMPORTANT'], []) }
  async unmarkImportant(messageId: string) { await this.modify(messageId, [], ['IMPORTANT']) }
  async trash(messageId: string) { await this.gmail().users.messages.trash({ userId: 'me', id: messageId }) }
  async restore(messageId: string) { await this.gmail().users.messages.untrash({ userId: 'me', id: messageId }) }

  // ── Attachments (any type) ─────────────────────────────────────────

  // Download a specific attachment (by filename) to scratch — no type filter,
  // unlike the .xlsx/.csv-only inbound processing path.
  async getAttachment(messageId: string, filename: string): Promise<string> {
    const gmail = this.gmail()
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    const acc = { text: '', html: '', atts: [] as gmail_v1.Schema$MessagePart[] }
    this.walk(res.data.payload, acc)
    const part = acc.atts.find(p => (p.filename ?? '') === filename) ?? acc.atts.find(p => (p.filename ?? '').includes(filename))
    if (!part?.body?.attachmentId) throw new Error(`Attachment "${filename}" not found on message`)
    if (Number(part.body.size ?? 0) > MAX_ATTACH) throw new Error('Attachment exceeds size cap')
    const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: part.body.attachmentId })
    const dir = path.join(SCRATCH, 'inbound', messageId)
    fs.mkdirSync(dir, { recursive: true })
    const outPath = path.join(dir, (part.filename ?? 'attachment').replace(/[^\w.\-]/g, '_'))
    fs.writeFileSync(outPath, Buffer.from(att.data.data ?? '', 'base64url'))
    return outPath
  }

  // ── Draft update (in-place) ────────────────────────────────────────

  async updateDraft(draftId: string, reply: Reply): Promise<void> {
    const raw = await this.buildRaw(reply)
    await this.gmail().users.drafts.update({ userId: 'me', id: draftId, requestBody: { message: { raw } } })
  }

  // ── Labels ─────────────────────────────────────────────────────────

  async listLabels(): Promise<{ id: string; name: string }[]> {
    const res = await this.gmail().users.labels.list({ userId: 'me' })
    return (res.data.labels ?? []).map(l => ({ id: l.id ?? '', name: l.name ?? '' }))
  }

  private async resolveLabelId(name: string): Promise<string | null> {
    const labels = await this.listLabels()
    const hit = labels.find(l => l.name.toLowerCase() === name.toLowerCase())
    return hit?.id ?? null
  }

  async createLabel(name: string): Promise<{ id: string; name: string }> {
    const res = await this.gmail().users.labels.create({
      userId: 'me',
      requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    })
    return { id: res.data.id ?? '', name: res.data.name ?? name }
  }

  async deleteLabel(name: string): Promise<void> {
    const id = await this.resolveLabelId(name)
    if (!id) throw new Error(`Label not found: ${name}`)
    await this.gmail().users.labels.delete({ userId: 'me', id })
  }

  async applyLabel(messageId: string, name: string): Promise<void> {
    let id = await this.resolveLabelId(name)
    if (!id) id = (await this.createLabel(name)).id   // create on demand
    await this.modify(messageId, [id], [])
  }

  async removeLabel(messageId: string, name: string): Promise<void> {
    const id = await this.resolveLabelId(name)
    if (!id) return
    await this.modify(messageId, [], [id])
  }

  // ── Sync: History API ──────────────────────────────────────────────

  async currentHistoryId(): Promise<string> {
    const res = await this.gmail().users.getProfile({ userId: 'me' })
    return String(res.data.historyId ?? '')
  }

  // Incremental changes since a historyId. Returns added/removed message ids.
  async history(startHistoryId: string): Promise<{ historyId: string; added: string[]; removed: string[] }> {
    const res = await this.gmail().users.history.list({ userId: 'me', startHistoryId })
    const added = new Set<string>()
    const removed = new Set<string>()
    for (const h of res.data.history ?? []) {
      for (const m of h.messagesAdded ?? []) if (m.message?.id) added.add(m.message.id)
      for (const m of h.messagesDeleted ?? []) if (m.message?.id) removed.add(m.message.id)
    }
    return { historyId: String(res.data.historyId ?? startHistoryId), added: [...added], removed: [...removed] }
  }

  // ── Sync: Pub/Sub watch (needs a Cloud Pub/Sub topic) ──────────────

  async watch(topicName: string): Promise<{ historyId: string; expiration: string }> {
    const res = await this.gmail().users.watch({ userId: 'me', requestBody: { topicName, labelIds: ['INBOX'] } })
    return { historyId: String(res.data.historyId ?? ''), expiration: String(res.data.expiration ?? '') }
  }
  async stopWatch(): Promise<void> {
    await this.gmail().users.stop({ userId: 'me' })
  }

  // ── Settings (need gmail.settings.basic / .sharing scope) ──────────

  async listFilters() {
    const res = await this.gmail().users.settings.filters.list({ userId: 'me' })
    return res.data.filter ?? []
  }
  async createFilter(criteria: gmail_v1.Schema$FilterCriteria, action: gmail_v1.Schema$FilterAction) {
    const res = await this.gmail().users.settings.filters.create({ userId: 'me', requestBody: { criteria, action } })
    return res.data
  }
  async deleteFilter(id: string) {
    await this.gmail().users.settings.filters.delete({ userId: 'me', id })
  }

  async getVacation() {
    const res = await this.gmail().users.settings.getVacation({ userId: 'me' })
    return res.data
  }
  async setVacation(settings: gmail_v1.Schema$VacationSettings) {
    const res = await this.gmail().users.settings.updateVacation({ userId: 'me', requestBody: settings })
    return res.data
  }

  async listSendAs() {
    const res = await this.gmail().users.settings.sendAs.list({ userId: 'me' })
    return res.data.sendAs ?? []
  }
  async updateSignature(sendAsEmail: string, signature: string) {
    const res = await this.gmail().users.settings.sendAs.patch({
      userId: 'me', sendAsEmail, requestBody: { signature },
    })
    return res.data
  }

  async listForwarding() {
    const res = await this.gmail().users.settings.forwardingAddresses.list({ userId: 'me' })
    return res.data.forwardingAddresses ?? []
  }

  async getImap() {
    const res = await this.gmail().users.settings.getImap({ userId: 'me' })
    return res.data
  }
  async setImap(enabled: boolean) {
    const res = await this.gmail().users.settings.updateImap({ userId: 'me', requestBody: { enabled } })
    return res.data
  }
  async getPop() {
    const res = await this.gmail().users.settings.getPop({ userId: 'me' })
    return res.data
  }

  async listDelegates() {
    const res = await this.gmail().users.settings.delegates.list({ userId: 'me' })
    return res.data.delegates ?? []
  }
}
