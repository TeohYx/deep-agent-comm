const feed = document.getElementById('feed')
const form = document.getElementById('goal-form')
const input = document.getElementById('goal-input')
const sendBtn = document.getElementById('send-btn')

// ---- helpers ----
function el(tag, cls, html) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function clearEmpty() {
  const es = feed.querySelector('.empty-state')
  if (es) es.remove()
}

function scrollDown() { feed.scrollTop = feed.scrollHeight }

// ---- render ----
function addUserMsg(text) {
  clearEmpty()
  const m = el('div', 'msg user')
  m.append(el('div', 'role', 'you'), el('div', 'bubble', escapeHtml(text)))
  feed.append(m)
  scrollDown()
}

function addThinking() {
  const m = el('div', 'msg agent')
  m.id = 'thinking'
  m.append(
    el('div', 'role', 'agent'),
    el('div', 'bubble', '<div class="thinking"><span></span><span></span><span></span></div>')
  )
  feed.append(m)
  scrollDown()
  return m
}

function renderStep(step) {
  const s = el('div', 'step')
  const head = el('div', 'step-head')
  head.append(el('span', `pill ${step.type}`, step.type))

  if (step.type === 'tool') {
    const name = step.input?.tool ?? '?'
    head.append(el('span', '', escapeHtml(name)))
    const ok = step.output?.success
    head.append(el('span', ok ? 'ok' : 'fail', ok ? '✓' : '✗'))
    s.append(head)
    s.append(el('pre', '', escapeHtml(JSON.stringify(step.input?.args ?? {}, null, 2))))
    s.append(el('pre', '', escapeHtml(JSON.stringify(step.output ?? {}, null, 2))))
  } else if (step.type === 'skill') {
    const names = (step.input?.matched ?? []).join(', ')
    head.append(el('span', '', escapeHtml(names)))
    s.append(head)
  } else {
    head.append(el('span', '', 'final answer'))
    s.append(head)
  }
  return s
}

function addAgentMsg(result, steps) {
  const m = el('div', 'msg agent')
  m.append(el('div', 'role', 'agent'))
  m.append(el('div', 'bubble', escapeHtml(result)))

  const traceSteps = (steps || []).filter(s => s.type === 'tool' || s.type === 'skill')
  if (traceSteps.length) {
    const toolCount = traceSteps.filter(s => s.type === 'tool').length
    const skillCount = traceSteps.filter(s => s.type === 'skill').length
    const parts = []
    if (skillCount) parts.push(`${skillCount} skill`)
    if (toolCount) parts.push(`${toolCount} tool call${toolCount > 1 ? 's' : ''}`)
    const trace = el('details', 'trace')
    trace.append(el('summary', '', parts.join(' · ')))
    traceSteps.forEach(s => trace.append(renderStep(s)))
    m.append(trace)
  }
  feed.append(m)
  scrollDown()
}

function addError(msg) {
  const m = el('div', 'msg agent')
  m.append(el('div', 'role', 'error'))
  const b = el('div', 'bubble')
  b.style.borderColor = 'var(--red)'
  b.style.color = 'var(--red)'
  b.textContent = msg
  m.append(b)
  feed.append(m)
  scrollDown()
}

// ---- run ----
async function runGoal(goal) {
  addUserMsg(goal)
  const thinking = addThinking()
  sendBtn.disabled = true

  try {
    const res = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    })
    thinking.remove()
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      addError(err.error || `Request failed (${res.status})`)
    } else {
      const data = await res.json()
      addAgentMsg(data.result, data.steps)
      loadHistory()
    }
  } catch (e) {
    thinking.remove()
    addError(String(e))
  } finally {
    sendBtn.disabled = false
  }
}

// ---- sidebar data ----
async function loadTools() {
  try {
    const tools = await (await fetch('/tools')).json()
    document.getElementById('tool-count').textContent = tools.length
    const ul = document.getElementById('tool-list')
    ul.innerHTML = ''
    tools.forEach(t => {
      const li = el('li')
      li.append(el('div', 'tool-name', escapeHtml(t.name)))
      li.append(el('div', 'tool-desc', escapeHtml(t.description)))
      ul.append(li)
    })
  } catch {}
}

async function loadSkills() {
  try {
    const skills = await (await fetch('/skills')).json()
    document.getElementById('skill-count').textContent = skills.length
    const ul = document.getElementById('skill-list')
    ul.innerHTML = ''
    skills.forEach(s => {
      const li = el('li')
      li.append(el('div', 'tool-name', escapeHtml(s.name)))
      li.append(el('div', 'tool-desc', escapeHtml(s.description)))
      ul.append(li)
    })
  } catch {}
}

async function loadHistory() {
  try {
    const tasks = await (await fetch('/tasks')).json()
    const ul = document.getElementById('history-list')
    ul.innerHTML = ''
    tasks.forEach(t => {
      const li = el('li')
      li.append(el('div', 'h-goal', escapeHtml(t.goal)))
      li.append(el('div', 'h-time', new Date(t.created_at).toLocaleString()))
      li.onclick = () => openTask(t.id)
      ul.append(li)
    })
  } catch {}
}

async function openTask(id) {
  try {
    const t = await (await fetch('/tasks/' + id)).json()
    clearEmpty()
    addUserMsg(t.goal)
    addAgentMsg(t.result, t.steps)
  } catch {}
}

// ---- events ----
form.addEventListener('submit', e => {
  e.preventDefault()
  const goal = input.value.trim()
  if (!goal) return
  input.value = ''
  input.style.height = 'auto'
  runGoal(goal)
})

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    form.requestSubmit()
  }
})

input.addEventListener('input', () => {
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, 200) + 'px'
})

// ---- init ----
loadTools()
loadSkills()
loadHistory()
