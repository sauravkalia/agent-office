// Departments, as pure data: long-running Claude Code sessions that each own an area (PR reviews,
// a set of repos, social media…). The supervisor in an HQ session hands a task to the right one
// with SendMessage instead of spawning a fresh subagent, so each department keeps its own history.
import type { Dispatch, LiveSession, SessionStatus } from '../types'
import { shorten } from './core'

export type Department = { label: string; folders: string[]; handles: string }

/**
 * `Label=folder,folder: what it handles | …`, as the `departments` option spells it. A folder is a
 * project folder's name (its last path part), matched against each running session's folder.
 */
export const parseDepartments = (s: string): Department[] =>
  s
    .split('|')
    .map(part => {
      const m = /^\s*([^=\s][^=]*?)\s*=\s*([^:]+?)\s*(?::\s*(.*?))?\s*$/.exec(part)
      if (!m?.[1] || !m[2]) return null
      const folders = m[2].split(',').map(f => f.trim()).filter(Boolean)
      return folders.length > 0 ? { label: m[1], folders, handles: m[3] ?? '' } : null
    })
    .filter((d): d is Department => d !== null)

const folderOf = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''

export type Desk = { folder: string; session: LiveSession | null; others: LiveSession[]; isSelf: boolean }

/**
 * Each department's desks: per folder, the session that staffs it. When HQ itself runs in that
 * folder, HQ is the desk (it does that department's work); otherwise the most recently active one.
 */
export const desksOf = (d: Department, live: readonly LiveSession[], selfId: string): Desk[] =>
  d.folders.map(folder => {
    const here = live.filter(s => folderOf(s.cwd).toLowerCase() === folder.toLowerCase())
    const self = here.find(s => s.sessionId === selfId)
    const rest = here.filter(s => s.sessionId !== selfId).sort((a, b) => b.updatedAt - a.updatedAt)
    return self ? { folder, session: self, others: rest, isSelf: true } : { folder, session: rest[0] ?? null, others: rest.slice(1), isSelf: false }
  })

/** What the supervisor reads when handed a task: who to message for what, and who's not in. */
export const rosterText = (depts: readonly Department[], live: readonly LiveSession[], selfId: string, hqName: string) => {
  const lines = [
    'Agent Office departments (running Claude Code sessions on this machine). To delegate, use SendMessage with `to` set to the session name in quotes.',
    `You are HQ${hqName ? ` ("${hqName}")` : ''}.`,
  ]
  for (const d of depts) {
    lines.push(`- ${d.label}${d.handles ? `: ${d.handles}` : ''}`)
    for (const desk of desksOf(d, live, selfId)) {
      lines.push(
        desk.isSelf
          ? `  - ${desk.folder}: that's you (HQ runs in this folder): do this department's work yourself, here, without SendMessage`
          : desk.session
          ? `  - ${desk.folder}: "${desk.session.name || desk.session.sessionId}" (${desk.session.status})${desk.others.length > 0 ? `; also open there: ${desk.others.map(o => `"${o.name}"`).join(', ')}` : ''}`
          : `  - ${desk.folder}: not running (the user opens a Claude Code session in the ${desk.folder} folder to staff it)`,
      )
    }
  }
  return lines.join('\n')
}

/** Which department and folder a session name belongs to, for labelling a dispatch. */
export const deptOfSession = (depts: readonly Department[], live: readonly LiveSession[], name: string) => {
  const s = live.find(x => x.name === name)
  if (!s) return null
  const folder = folderOf(s.cwd).toLowerCase()
  const d = depts.find(x => x.folders.some(f => f.toLowerCase() === folder))
  return d ? { label: d.label, folder: folderOf(s.cwd) } : null
}

/** A cross-session message's sender and first line, from the text a turn opens with. */
export const crossMessageOf = (text: string): { fromName: string; body: string } | null => {
  const m = /<cross-session-message\b[^>]*?\bfrom-name="([^"]*)"[^>]*>([\s\S]*?)(?:<\/cross-session-message>|$)/.exec(text)
  if (!m) return null
  const body = (m[2] ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return { fromName: m[1] ?? '', body: shorten(body, 80) }
}

/** Dispatches after a reply from `fromName`: a session works through its messages in order, so its oldest open one is answered. */
export const answerDispatch = (list: readonly Dispatch[], fromName: string, body: string, at: number): Dispatch[] => {
  const open = list.find(x => x.to === fromName && x.status === 'sent')
  return open ? list.map(x => (x === open ? { ...x, status: 'replied', reply: body, endedAt: at } : x)) : [...list]
}

/**
 * A session often takes several queued messages in one turn and answers them all in one reply.
 * Once it's idle after replying (and a few seconds have passed, so a second reply isn't on its
 * way), every task sent to it before that reply counts as answered by it.
 */
export const settleIdle = (list: readonly Dispatch[], live: readonly LiveSession[], now: number, graceMs = 5_000): Dispatch[] => {
  let out = [...list]
  for (const s of live) {
    if (s.status === 'busy' || !s.name) continue
    const reply = [...out].reverse().find(x => x.to === s.name && x.status === 'replied' && x.endedAt !== undefined)
    if (!reply || now - reply.endedAt! < graceMs) continue
    out = out.map(x => (x.to === s.name && x.status === 'sent' && x.at < reply.endedAt! ? { ...x, status: 'replied', reply: reply.reply, endedAt: reply.endedAt } : x))
  }
  return out
}

// ---------------------------------------------------------------- the work board

/** `Edit → hooks/core.ts` (a status line) → `editing hooks/core.ts`. */
export const activityOf = (text: string) => {
  const m = /^(\w+)(?: → (.*))?$/.exec(text.trim())
  if (!m) return text.trim()
  const verb: Record<string, string> = { Edit: 'editing', MultiEdit: 'editing', Write: 'writing', NotebookEdit: 'editing', Read: 'reading', Bash: 'running', Grep: 'searching', Glob: 'searching', WebSearch: 'researching', WebFetch: 'reading', Agent: 'handing off', Task: 'handing off', SendMessage: 'messaging' }
  const v = verb[m[1]!] ?? m[1]!.toLowerCase()
  return m[2] ? `${v} ${m[2]}` : v
}

export type BoardItem =
  | { kind: 'working'; label: string; repo: string | null; task: string; since: number; activity: string | null; queued: number; isBusy: boolean }
  | { kind: 'done'; label: string; repo: string | null; reply: string; at: number }

/**
 * One line of the board per department: the task it's on (its oldest open one, since a session
 * answers its messages in order), how many wait behind it, and what its session is doing now; or,
 * with nothing open, what it last finished, for a quarter of an hour.
 */
export const boardOf = (
  depts: readonly { label: string; isBusy: boolean; repo: string | null; activity: string | null }[],
  list: readonly Dispatch[],
  now: number,
): BoardItem[] =>
  depts.flatMap((d): BoardItem[] => {
    const open = list.filter(x => x.dept === d.label && x.status === 'sent')
    const job = open[0]
    if (job) return [{ kind: 'working', label: d.label, repo: d.repo ?? job.repo ?? null, task: job.task, since: job.at, activity: d.isBusy ? d.activity : null, queued: open.length - 1, isBusy: d.isBusy }]
    const last = [...list].reverse().find(x => x.dept === d.label && x.status === 'replied')
    return last && now - (last.endedAt ?? last.at) < 15 * 60_000 ? [{ kind: 'done', label: d.label, repo: last.repo ?? null, reply: last.reply ?? 'replied', at: last.endedAt ?? last.at }] : []
  })

// ---------------------------------------------------------------- handoff alerts

/** A department session as HQ sees it for the handoff alert. */
export type HandoffDesk = { name: string; label: string; isSelf: boolean; status: SessionStatus | null }
export type HandoffAlert = { name: string; label: string; pct: number; level: number }

/** A status file older than this says nothing about the session's context now. */
export const HANDOFF_STALE_MS = 5 * 60_000

/**
 * Which department sessions just crossed a handoff level, once per level per session (by its
 * name, which /clear keeps). A jump past several levels is one alert, at the highest. A session
 * whose fill drops below a level (after /clear or a compaction) can be told again at that level.
 * HQ itself, and sessions with no status file or a stale one, are left out and keep their state.
 */
export const handoffAlerts = (
  fired: Readonly<Record<string, readonly number[]>>,
  desks: readonly HandoffDesk[],
  levels: readonly number[],
  now: number,
  staleMs = HANDOFF_STALE_MS,
): { fired: Record<string, number[]>; alerts: HandoffAlert[] } => {
  const out: Record<string, number[]> = Object.fromEntries(Object.entries(fired).map(([k, v]) => [k, [...v]]))
  const alerts: HandoffAlert[] = []
  for (const d of desks) {
    const pct = d.status?.ctxPct
    if (d.isSelf || !d.name || !d.status || pct === undefined || now - d.status.at > staleMs) continue
    const kept = (out[d.name] ?? []).filter(l => pct >= l)
    const fresh = levels.filter(l => pct >= l && !kept.includes(l))
    out[d.name] = [...kept, ...fresh].sort((a, b) => a - b)
    if (fresh.length > 0) alerts.push({ name: d.name, label: d.label, pct: Math.round(pct), level: fresh[fresh.length - 1]! })
  }
  return { fired: out, alerts }
}

export const handoffMessage = (pct: number) =>
  `Context at ${pct}%. Finish your current step, write a short handoff (done, pending, branches/PRs), and tell Saurav you're ready for /clear.`

// ---------------------------------------------------------------- waiting on you

/** Words that hand a decision to the user without a question mark. */
const HANDS_OVER =
  /\b(say (the word|if|when|which|so)|tell me (which|what|if|whether|when|how)|let me know (if|whether|which|what|when|how)|your call|up to you|until you (say|ok|approve|confirm)|i'?ll wait for your|waiting (on|for) your|once you (approve|confirm|ok|say)|(ok|okay|good) to (push|merge|publish|release|post|deploy|go|proceed)|i can [^.]{0,80}\bif you (want|'d like|like)|if you want me to)\b/i

/**
 * Whether a finished turn's answer ends by asking the user something, from its closing words
 * alone. Only the last paragraph counts, after code blocks, inline code, quotes, tables and
 * headings are taken out, so a "?" in a summary, a snippet or a quoted message doesn't. It asks
 * when that paragraph's last sentence (or a list item in it) ends in "?", or when it hands the
 * decision over in words: "say the word", "let me know if", "your call", "OK to push".
 */
export const asksUser = (answer: string): boolean => {
  // Quoted words the user would type back ("say \"post it\"") are the ask itself, not a quote.
  const text = answer
    .replace(/\b(say|type|reply|answer)\s+["“][^"”\n]{1,30}["”]/gi, '$1 the word')
    .replace(/```[\s\S]*?(```|$)/g, '\n\n')
    .replace(/`[^`\n]*`/g, 'x')
    .split('\n')
    .filter(l => !/^\s*(>|\||#{1,6}\s|[-*_]{3,}\s*$)/.test(l))
    .join('\n')
    // Quoted speech: "…?" or “…?” is someone else's question.
    .replace(/["“][^"”\n]*["”]/g, 'x')
    .replace(/\*\*|__/g, '')
    .replace(/(^|\W)[*_](\S)/g, '$1$2')
    .replace(/(\S)[*_](\W|$)/g, '$1$2')
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const last = paras[paras.length - 1]
  if (!last) return false
  const lines = last.split('\n').map(l => l.trim()).filter(Boolean)
  // A list closing the answer: any item that asks.
  const items = lines.filter(l => /^([-*+]|\d+[.)])\s/.test(l))
  if (items.length > 0 && items.length === lines.length - (/:$/.test(lines[0] ?? '') ? 1 : 0) && items.some(l => /\?\s*$/.test(l))) return true
  // An aside after the question ("Want me to open the PR? (It targets main.)") doesn't end the ask.
  const sentences = last.replace(/\n/g, ' ').replace(/([.!?)])\s+/g, '$1\u0000').split('\u0000').filter(Boolean)
  while (sentences.length > 1 && /^\(.*\)$/.test(sentences[sentences.length - 1]!)) sentences.pop()
  const tail = sentences[sentences.length - 1] ?? ''
  if (/\?\s*[)\]]?\s*$/.test(tail)) return true
  // "Nothing gets posted until you say so" states a rule for later; it isn't asking now.
  return HANDS_OVER.test(sentences.slice(-2).filter(x => !/^nothing\b/i.test(x)).join(' '))
}
