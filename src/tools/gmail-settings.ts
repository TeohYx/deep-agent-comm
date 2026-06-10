// Gmail Settings tools — require the gmail.settings.basic / gmail.settings.sharing
// OAuth scopes. After adding these scopes to src/channels/gmail-oauth.ts, re-run
// the bootstrap to re-consent; until then these tools return a scope error.
//
// NOTE: still no send capability. Send-as here manages alias CONFIG + signatures,
// it does not send mail.

import { Tool, ToolResult } from '../core/types.js'
import { gmailChannel } from '../channels/gmail.js'

export const gmailFiltersTool: Tool = {
  name: 'gmail_filters',
  description:
    'Server-side filters/rules. action: list | create | delete. For create, pass criteria (e.g. {from, subject, query, hasAttachment}) and action (e.g. {addLabelIds, removeLabelIds, forward}). For delete, pass id.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'delete'] },
      criteria: { type: 'object', description: 'Gmail FilterCriteria (from, to, subject, query, hasAttachment, ...)' },
      filterAction: { type: 'object', description: 'Gmail FilterAction (addLabelIds, removeLabelIds, forward)' },
      id: { type: 'string', description: 'Filter id (for delete)' },
    },
    required: ['action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const action = String(input.action)
      if (action === 'list') return { success: true, output: { filters: await gmailChannel.listFilters() } }
      if (action === 'create') {
        const created = await gmailChannel.createFilter((input.criteria ?? {}) as any, (input.filterAction ?? {}) as any)
        return { success: true, output: created }
      }
      if (!input.id) return { success: false, output: null, error: 'id required for delete' }
      await gmailChannel.deleteFilter(String(input.id))
      return { success: true, output: 'filter deleted' }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailVacationTool: Tool = {
  name: 'gmail_vacation',
  description:
    'Vacation auto-responder. action: get | set. For set, pass enabled (bool), responseSubject, responseBodyPlainText, and optionally startTime/endTime (epoch ms as strings).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set'] },
      enabled: { type: 'boolean' },
      responseSubject: { type: 'string' },
      responseBodyPlainText: { type: 'string' },
      startTime: { type: 'string' },
      endTime: { type: 'string' },
    },
    required: ['action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      if (String(input.action) === 'get') return { success: true, output: await gmailChannel.getVacation() }
      const res = await gmailChannel.setVacation({
        enableAutoReply: Boolean(input.enabled),
        responseSubject: input.responseSubject ? String(input.responseSubject) : undefined,
        responseBodyPlainText: input.responseBodyPlainText ? String(input.responseBodyPlainText) : undefined,
        startTime: input.startTime ? String(input.startTime) : undefined,
        endTime: input.endTime ? String(input.endTime) : undefined,
      })
      return { success: true, output: res }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailSendAsTool: Tool = {
  name: 'gmail_sendas',
  description:
    'Send-as aliases + signatures (config only — does NOT send mail). action: list | update_signature (pass sendAsEmail + signature HTML).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'update_signature'] },
      sendAsEmail: { type: 'string' },
      signature: { type: 'string' },
    },
    required: ['action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      if (String(input.action) === 'list') return { success: true, output: { sendAs: await gmailChannel.listSendAs() } }
      if (!input.sendAsEmail || input.signature === undefined)
        return { success: false, output: null, error: 'sendAsEmail and signature required' }
      const res = await gmailChannel.updateSignature(String(input.sendAsEmail), String(input.signature))
      return { success: true, output: { updated: res.sendAsEmail } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailForwardingTool: Tool = {
  name: 'gmail_forwarding',
  description: 'List configured forwarding addresses (read-only).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(): Promise<ToolResult> {
    try {
      return { success: true, output: { forwardingAddresses: await gmailChannel.listForwarding() } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailImapPopTool: Tool = {
  name: 'gmail_imap_pop',
  description: 'IMAP/POP protocol access settings. action: get_imap | set_imap (enabled bool) | get_pop.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get_imap', 'set_imap', 'get_pop'] },
      enabled: { type: 'boolean' },
    },
    required: ['action'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      switch (String(input.action)) {
        case 'get_imap': return { success: true, output: await gmailChannel.getImap() }
        case 'set_imap': return { success: true, output: await gmailChannel.setImap(Boolean(input.enabled)) }
        case 'get_pop': return { success: true, output: await gmailChannel.getPop() }
        default: return { success: false, output: null, error: 'unknown action' }
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailDelegatesTool: Tool = {
  name: 'gmail_delegates',
  description: 'List account delegates (read-only).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async execute(): Promise<ToolResult> {
    try {
      return { success: true, output: { delegates: await gmailChannel.listDelegates() } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const gmailSettingsTools: Tool[] = [
  gmailFiltersTool,
  gmailVacationTool,
  gmailSendAsTool,
  gmailForwardingTool,
  gmailImapPopTool,
  gmailDelegatesTool,
]
