// One-time OAuth bootstrap for the Gmail API channel.
// Run: npx tsx src/channels/gmail-oauth.ts
//
// Opens Google consent in your browser, captures the auth code on a loopback
// server, exchanges it for a refresh token, and saves it to
// secrets/gmail.token.json (gitignored). After this, the channel refreshes
// access tokens automatically — you never run this again unless you revoke.

import 'dotenv/config'
import { google } from 'googleapis'
import http from 'http'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'

const CLIENT_SECRET_PATH = path.resolve('secrets/google_oauth_client.json')
const TOKEN_PATH = path.resolve('secrets/gmail.token.json')
const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}`

// Scopes:
// - gmail.modify         → read messages/threads, drafts, labels, organize, history, watch
// - gmail.settings.basic → filters, vacation, send-as/signature, forwarding, imap/pop
// - gmail.settings.sharing → delegates
// (Send is still withheld at the TOOL level — no send tool is registered.)
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
]

function loadClient() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(`Client secret not found at ${CLIENT_SECRET_PATH}`)
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'))
  const cfg = raw.installed ?? raw.web
  if (!cfg) throw new Error('Unexpected client secret format (no installed/web key)')
  return new google.auth.OAuth2(cfg.client_id, cfg.client_secret, REDIRECT_URI)
}

async function main() {
  const oauth2 = loadClient()

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',      // ask for a refresh token
    prompt: 'consent',           // force refresh-token issuance even if previously granted
    scope: SCOPES,
  })

  console.log('\n=== Gmail API authorization ===')
  console.log('Opening your browser to consent. If it does not open, paste this URL:\n')
  console.log(authUrl + '\n')

  // best-effort browser open (Windows)
  spawn('cmd', ['/c', 'start', '""', authUrl], { stdio: 'ignore', windowsHide: true }).on('error', () => {})

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '', REDIRECT_URI)
        const c = url.searchParams.get('code')
        const err = url.searchParams.get('error')
        if (err) {
          res.end(`Authorization failed: ${err}. You can close this tab.`)
          server.close()
          return reject(new Error(err))
        }
        if (c) {
          res.end('Authorized. You can close this tab and return to the terminal.')
          server.close()
          resolve(c)
        } else {
          res.end('Waiting for authorization code...')
        }
      } catch (e) {
        reject(e)
      }
    })
    server.listen(PORT, () => console.log(`Listening for the OAuth redirect on ${REDIRECT_URI} ...`))
  })

  const { tokens } = await oauth2.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and re-run.')
  }

  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify({ refresh_token: tokens.refresh_token, scope: SCOPES.join(' '), obtained_at: Date.now() }, null, 2)
  )
  console.log(`\n✓ Refresh token saved to ${TOKEN_PATH}`)
  console.log('You can now switch the channel to Gmail API. This script need not be run again.\n')
  process.exit(0)
}

main().catch(e => {
  console.error('OAuth bootstrap failed:', e.message)
  process.exit(1)
})
