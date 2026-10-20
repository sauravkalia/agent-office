import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, Architect, Building, Bucket, Dispatch, LiveSession, SessionStatus, Check, Gate, Layout, LogLine, Loop, Main, Person, Roster, Route, Turn, Usage, View } from '../types'
import {
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  SCHEMA_VERSION,
  afterCall,
  applyStep,
  bucketOf,
  cardTitle,
  titleLines,
  consultTimeline,
  describeInput,
  endConsult,
  fitLegend,
  fmtClock,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  plural,
  gateSummary,
  gauge,
  isAdvising,
  isLoopActive,
  kTokens,
  lanes,
  limitLabel,
  limitOf,
  fmtResetIn,
  fmtSpeed,
  listOf,
  logRows,
  momentOf,
  normalize,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  noteTool,
  PALETTES,
  alertText,
  crossedAlerts,
  SVG_COLORS,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  settleCheck,
  shorten,
  startConsult,
  stepSpeed,
  stepLoop,
} from './core'
import type { Config, Panel } from './core'
import { base64, drawOffice, encodePng, rowsFor, termShowsImages } from './pixel-core'
import type { Walk } from './pixel-core'
import { cellFromWinsize, parseStatus, repoInText, repoOfCall, reposIn, shortRepo } from './status-core'
import { direct, newDirector } from './dept-office'
import type { DeptInput, SlotInfo } from './dept-office'
import { AW as ART_W, AH as ART_H, HQ_SLOT, ROOM_ZONES, drawScene, lookOf, parseCell, pixelBox, scaleInto, setLayout } from './pixel2-core'
import type { RoomZone } from './pixel2-core'
import { encodePngRgb } from './png-core'
import { activityOf, answerDispatch, boardOf, crossMessageOf, deptOfSession, desksOf, rosterText, settleIdle } from './departments-core'
import { agoOf, buildingScene, projectOf, historySince, parseHistory, parseLive } from './building-core'
import { SESSION, applyTarget, cacheKey, classify, decide } from './supervisor-core'
import type { Tier } from './supervisor-core'
import { STORE_PREFIX, dayOf, lastDays, normalizeDay, recordTurn, staleKeys, usageReport } from './usage-core'
import { ROOMS, zoneOf, finishErrand, namesFor, normalizeErrands, officeLine, officeRows, officeScene, orgLine, roleOf, roomLabel, startErrand, teamOf } from './office-core'

const PANE = 'agent-office'
const TITLE = 'Agent Office'
const PANE_COLUMNS = 66


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'agent-office', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'agent-office', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'agent-office', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'agent-office', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'agent-office', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'agent-office', key: 'agents' } as const, [])
const loops = atom({ plugin: 'agent-office', key: 'loops' } as const, [])
const log = atom({ plugin: 'agent-office', key: 'log' } as const, [])
const turn = atom({ plugin: 'agent-office', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'agent-office', key: 'receipt' } as const, null)
const view = atom({ plugin: 'agent-office', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'agent-office', key: 'roster' } as const, DEFAULT_ROSTER)
const errands = atom({ plugin: 'agent-office', key: 'errands' } as const, {})
const alerts = atom({ plugin: 'agent-office', key: 'alerts' } as const, { fired: [] })
const sessionDay = atom({ plugin: 'agent-office', key: 'sessionDay' } as const, { day: '' })
const DEFAULT_ROUTE: Route = { override: null, current: SESSION, base: null, lastStepAt: 0, warm: {}, pending: null, last: null, savedUsd: 0, switches: 0 }
const route = atom({ plugin: 'agent-office', key: 'route' } as const, DEFAULT_ROUTE)
const DEFAULT_BUILDING: Building = { live: [], past: [], scannedAt: 0, historyMtime: 0, problem: null }
const building = atom({ plugin: 'agent-office', key: 'building' } as const, DEFAULT_BUILDING)
const dispatches = atom({ plugin: 'agent-office', key: 'dispatches' } as const, [])
const pixelEnv = atom({ plugin: 'agent-office', key: 'pixelEnv' } as const, { images: false, denied: false })
/**
 * What this terminal can show and the office style you picked, kept by the mod itself: /clear
 * hands the session an empty store and session.start doesn't run again, so without this the
 * pixel office fell back to text and believed the terminal couldn't show pictures.
 */
const term: { images: boolean | null; cell: { w: number; h: number } | null; style: 'text' | 'pixel' | null } = { images: null, cell: null, style: null }

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getLog($: EngineInterface): Promise<LogLine[]> {
  return normalizeLog(await read($, log))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
/** The supervisor's mode: what `/office route` set for this session, else the configured `routing`. */
const modeOf = (r: Route, cfg: Config) => r.override ?? cfg.routing
async function getRoute($: EngineInterface): Promise<Route> {
  const r = normalize(DEFAULT_ROUTE, await read($, route))
  return { ...r, current: normalize(SESSION, r.current) }
}
async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, log, list => normalizeLog(list))
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

async function say($: EngineInterface, who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  const line: LogLine = { at: await $.clock.now(), who, text, kind, agentId }
  await update($, log, list => [...normalizeLog(list), line].slice(-60))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [u, a, g, cards] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($)])
  const running = cards.filter(c => c.status === 'running').length
  const s = gateSummary(g)
  const parts = [
    u.pct !== null ? `ctx ${Math.round(u.pct)}%` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    // The budget only once it is worth a glance: from the first alert level on.
    cfg.costBudgetUsd > 0 && u.costUsd !== null && (u.costUsd / cfg.costBudgetUsd) * 100 >= (cfg.costWarnPct[0] ?? 50)
      ? `budget ${Math.round((u.costUsd / cfg.costBudgetUsd) * 100)}%`
      : null,
    s.deny > 0 ? `denied ${s.deny}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
}

async function whoIs($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return 'main'
  const card = (await getCards($)).find(c => c.id === agentId)
  return card ? shorten(cardTitle(card), 14) : 'agent'
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = await $.clock.now()
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await say($, cfg.architectLabel.toLowerCase(), cfg.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const first = advice?.split('\n').find(l => l.trim()) ?? null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  await say($, cfg.architectLabel.toLowerCase(), text ? `advice: ${shorten(text, 60)}` : 'advice returned', 'consult')
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
  await say($, cfg.architectLabel.toLowerCase(), `advice: ${shorten(advice, 60)}`, 'consult')
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8 })
}

async function resetAll($: EngineInterface) {
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, log, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  // The office style is a choice about this terminal, not the conversation: it stays.
  await update($, view, x => ({ ...DEFAULT_VIEW, style: normalize(DEFAULT_VIEW, x).style }))
  await update($, errands, () => ({}))
  await update($, alerts, () => ({ fired: [] }))
  await update($, sessionDay, () => ({ day: '' }))
  await update($, dispatches, () => [])
  await update($, route, r => ({ ...DEFAULT_ROUTE, override: normalize(DEFAULT_ROUTE, r).override, savedUsd: normalize(DEFAULT_ROUTE, r).savedUsd }))
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null }))
}

/** The session's cost read fresh, not from the last measurement: the receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return u?.cost?.usd ?? null
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

/**
 * One finished main turn into the daily usage log: `$.store` under `usage:<day>`, mirrored to
 * `~/.claude/agent-office/usage/<day>.json`. A session is filed under the day it started.
 */
async function logUsage($: EngineInterface, agentsThisTurn: number) {
  const [sid, cwd, m, now, fresh, measured] = await Promise.all([$.session.id(), $.session.cwd(), getMain($), $.clock.now(), costNow($), getUsage($)])
  const cost = fresh ?? measured.costUsd
  let day = (await read($, sessionDay))?.day ?? ''
  if (!day) {
    day = dayOf(now)
    await update($, sessionDay, () => ({ day }))
  }
  const key = `${STORE_PREFIX}${day}`
  const log = recordTurn(normalizeDay(await $.store.get(key)), sid, { cwd, model: m.model, costUsd: cost, agents: agentsThisTurn, at: now })
  await $.store.set(key, log)
  const home = await $.env.get('HOME')
  if (home) await $.fs.write(`${home}/.claude/agent-office/usage/${day}.json`, `${JSON.stringify(log, null, 2)}\n`)
}

/** Drops store days past the keeping window; the JSON files stay where they are. */
async function pruneUsage($: EngineInterface) {
  const now = await $.clock.now()
  for (const k of staleKeys(await $.store.keys(), now)) await $.store.delete(k)
}

const PROMPT_CACHE_MS = 60 * 60_000

/** The department office has four shared rooms; the text office's other rooms count as the desk. */
const ROOM_OF: Partial<Record<string, string>> = { archives: 'archives', warehouse: 'warehouse', server: 'server', workshop: 'workshop' }

/**
 * The supervisor at the start of a turn you typed: classify the prompt, then move the main loop to
 * that tier's model and effort if the move pays for its re-cache (always, for an upgrade or a pin).
 */
async function supervise($: EngineInterface, cfg: Config, text: string, base: NonNullable<Route['base']>, now: number) {
  const r = await getRoute($)
  const mode = modeOf(r, cfg)
  if (mode === 'off') {
    if (r.current.model || r.current.effort) await update($, route, x => ({ ...normalize(DEFAULT_ROUTE, x), current: SESSION }))
    return
  }
  const [m, u] = await Promise.all([getMain($), getUsage($)])
  const isPinned = mode !== 'auto'
  const c = isPinned ? { tier: mode as Tier, why: 'pinned' } : classify(text, { isPlanMode: m.mode === 'plan' })
  if (c.tier === 'continue') {
    await update($, route, x => ({ ...normalize(DEFAULT_ROUTE, x), last: { tier: 'continue', why: c.why, note: 'carries on as before', isSwitch: false } }))
    return
  }
  const d = decide({
    tier: c.tier,
    current: r.current,
    base,
    ctxTokens: u.tokens ?? 0,
    isCacheWarm: r.lastStepAt > 0 && now - r.lastStepAt < PROMPT_CACHE_MS,
    isPinned,
    cfg: cfg.supervisor,
    cached: Object.fromEntries(Object.entries(r.warm ?? {}).filter(([, w]) => now - w.at < PROMPT_CACHE_MS).map(([k, w]) => [k, w.tokens])),
  })
  await update($, route, x => {
    const y = normalize(DEFAULT_ROUTE, x)
    return {
      ...y,
      current: d.next,
      last: { tier: c.tier, why: c.why, note: d.note, isSwitch: d.isSwitch },
      savedUsd: y.savedUsd + d.savingUsd,
      switches: y.switches + (d.isSwitch ? 1 : 0),
    }
  })
  if (d.isSwitch || d.note.startsWith('kept')) await say($, 'model', `${c.tier} (${c.why}) ${d.note}`, 'consult')
}

/**
 * Looks around the machine: the running sessions in ~/.claude/sessions (only its *.json files; the
 * .key files beside them are never read), and the history file when it changed since the last look.
 */
async function scanBuilding($: EngineInterface, cfg: Config, withHistory = true) {
  const home = await $.env.get('HOME')
  if (!home) return
  const now = await $.clock.now()
  const was = normalize(DEFAULT_BUILDING, await read($, building))
  const live: LiveSession[] = []
  let problem: string | null = null
  try {
    for (const f of await $.fs.list(`${home}/.claude/sessions`)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      const s = parseLive(await $.fs.read(`${home}/.claude/sessions/${f.name}`).catch(() => ''))
      if (s) live.push(s)
    }
  } catch {
    problem = 'the session registry is not readable'
  }
  // Department sessions say which room they're working in (status files written by their own mod).
  const status: Record<string, SessionStatus> = {}
  if (cfg.departments.length > 0)
    for (const s of live) {
      const text = await $.fs.read(`${home}/.claude/agent-office/status/${s.sessionId}.json`).catch(() => '')
      const st = parseStatus(text)
      if (st) status[s.sessionId] = st
    }
  let past = was.past
  let historyMtime = was.historyMtime
  if (withHistory) {
    try {
      const st = await $.fs.stat(`${home}/.claude/history.jsonl`)
      if (st.mtimeMs !== was.historyMtime) {
        past = parseHistory(await $.fs.read(`${home}/.claude/history.jsonl`), historySince(now))
        historyMtime = st.mtimeMs
      }
    } catch {
      problem = problem ?? 'the prompt history is not readable (over 4 MB?)'
    }
  }
  await update($, building, () => ({ live, past, scannedAt: now, historyMtime, problem, status }))
  if (cfg.departments.length > 0) {
    const list = listOf<Dispatch>(await read($, dispatches))
    const settled = settleIdle(list, live, now)
    if (settled.some((x, i) => x !== list[i])) await update($, dispatches, () => settled)
    await toastStarts($, cfg, live, status, now)
  }
}

/**
 * "Sphere Dev is working on …": once per task, when the department's session turns busy with a
 * task HQ handed it in the last ten minutes, naming the repo it's in.
 */
const toasted = new Set<string>()
async function toastStarts($: EngineInterface, cfg: Config, live: LiveSession[], status: Record<string, SessionStatus>, now: number) {
  const list = listOf<Dispatch>(await read($, dispatches))
  const selfId = await $.session.id().catch(() => '')
  for (const d of cfg.departments) {
    const job = list.find(x => x.dept === d.label && x.status === 'sent')
    if (!job || toasted.has(`${job.dept}|${job.at}`) || now - job.at > 10 * 60_000) continue
    const desk = desksOf(d, live, selfId).find(k => !k.isSelf && k.session?.name === job.to)
    if (desk?.session?.status !== 'busy') continue
    toasted.add(`${job.dept}|${job.at}`)
    const repo = status[desk.session.sessionId]?.repo ?? job.repo
    $.ui.toast(`${d.label} is working on: ${shorten(job.task, 60)}${repo ? ` (${repo})` : ''}`, { timeoutMs: 6000 })
  }
}

/**
 * This session's status file, for the department office in HQ: the room it's working in now and
 * what it's doing. Written when the room or the line changes, at most every second otherwise.
 */
let lastStatus = { key: '', at: 0 }
/** The repo this session last worked in, for a folder of several repos; '' when it can't tell. */
let lastRepo = ''
/** The session folder's own folders (its repos, in a folder of several), looked up once a minute. */
let folders = { cwd: '', at: 0, names: new Set<string>() }
async function subfolders($: EngineInterface, cwd: string) {
  const now = await $.clock.now()
  if (folders.cwd === cwd && now - folders.at < 60_000) return folders.names
  const list = await $.fs.list(cwd).catch(() => [])
  folders = { cwd, at: now, names: new Set(list.filter(f => f.kind === 'dir' && !f.name.startsWith('.')).map(f => f.name)) }
  return folders.names
}
async function writeStatus($: EngineInterface, zone: string, text: string, isError = false) {
  const now = await $.clock.now()
  const key = `${zone}|${text}|${isError}|${lastRepo}`
  if (key === lastStatus.key && now - lastStatus.at < 1000) return
  lastStatus = { key, at: now }
  const [home, sid] = await Promise.all([$.env.get('HOME'), $.session.id().catch(() => '')])
  if (!home || !sid) return
  await $.fs.write(`${home}/.claude/agent-office/status/${sid}.json`, JSON.stringify({ zone, text, isError, at: now, ...(lastRepo ? { repo: lastRepo } : {}) }))
}

/**
 * The terminal's cell size in pixels, from the window size its tty reports (kitty, Ghostty and
 * WezTerm fill in the pixel fields). One short python3 call; anything unexpected keeps the old value.
 */
const CELL_PROBE = [
  'import fcntl, termios, struct',
  'with open("/dev/tty") as t:',
  '    r, c, x, y = struct.unpack("HHHH", fcntl.ioctl(t, termios.TIOCGWINSZ, b"0" * 8))',
  'print(r, c, x, y)',
].join('\n')
async function measureCell($: EngineInterface) {
  const r = await $.process.run(['python3', '-c', CELL_PROBE])
  const cell = cellFromWinsize(r.exitCode === 0 ? r.stdout : '')
  if (cell) term.cell = cell
  if (cell) await update($, pixelEnv, x => ({ images: x?.images ?? false, denied: x?.denied ?? false, cell }))
}

/** `/office route [auto|off|light|standard|heavy]`: show or set the supervisor. */
async function routeText($: EngineInterface, cfg: Config, arg: string) {
  const modes = ['auto', 'off', 'light', 'standard', 'heavy'] as const
  const mode = modes.find(x => x === arg)
  if (arg && !mode) return 'Usage: /office route [auto|off|light|standard|heavy]'
  if (mode) await update($, route, x => ({ ...normalize(DEFAULT_ROUTE, x), override: mode, ...(mode === 'off' ? { current: SESSION } : {}) }))
  const r = await getRoute($)
  const now = r.base ? `${prettyModel(r.current.model ?? r.base.model)} (${r.current.effort ?? r.base.effort ?? 'default'} effort)` : 'the session model (no request yet)'
  return [
    `**Supervisor: ${modeOf(r, cfg)}**${mode ? ' (set for this session)' : ''}`,
    '',
    `| | |`,
    `|---|---|`,
    `| Main loop runs on | ${now} |`,
    `| Last decision | ${r.last ? `${r.last.tier} (${r.last.why}): ${r.last.note}` : '—'} |`,
    `| Switches this session | ${r.switches} |`,
    `| Estimated saving | ${fmtUsd(r.savedUsd)} |`,
  ].join('\n')
}

/** `/office usage [today|week]`: the log as a table. */
async function usageText($: EngineInterface, arg: string) {
  const span = arg === 'week' ? 'week' : 'today'
  const now = await $.clock.now()
  const days = await Promise.all(lastDays(now, span === 'week' ? 7 : 1).map(async day => ({ day, log: normalizeDay(await $.store.get(`${STORE_PREFIX}${day}`)) })))
  return `${usageReport(span, days)}\n\nDaily files: ~/.claude/agent-office/usage/`
}

/** `/office` (and its alias `/flightdeck`): open, close, reset, or set the layout. */
async function runOffice($: EngineInterface, cfg: Config, args: string) {
  const [verb = 'open', arg = ''] = args.trim().split(/\s+/)
  if (verb === 'close') {
    await $.ui.close({ id: PANE })
    return { text: 'Agent Office closed.' }
  }
  if (verb === 'reset') {
    await resetAll($)
    await refreshStatus($, cfg)
    return { text: 'Agent Office reset.' }
  }
  if (verb === 'building' || verb === 'office') {
    const scene: 'building' | 'office' = verb
    await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), scene }))
    if (scene === 'building') await scanBuilding($, cfg).catch(() => undefined)
    const opened = await openPane($)
    return { text: opened.isPlaced ? (scene === 'building' ? 'Showing every session on this machine.' : 'Showing this session\'s office.') : `Not shown yet: ${opened.reason}` }
  }
  if (verb === 'pixel') {
    const v = normalize(DEFAULT_VIEW, await read($, view))
    const style: 'text' | 'pixel' = arg === 'off' || arg === 'text' ? 'text' : arg === 'on' ? 'pixel' : (v.style ?? term.style ?? cfg.officeStyle) === 'pixel' ? 'text' : 'pixel'
    term.style = style
    const scene: 'office' | 'building' = 'office'
    await update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), style, scene }))
    if (style === 'pixel') await update($, pixelEnv, x => ({ images: x?.images ?? false, denied: false }))
    const env = await read($, pixelEnv)
    await openPane($)
    return {
      text:
        style === 'text'
          ? 'Office back to text.'
          : env?.images || term.images
            ? 'Pixel office on. /office pixel again (or p in the pane) switches back.'
            : "Pixel office on, but this terminal doesn't look like it shows pictures (kitty, Ghostty or WezTerm, not under tmux), so the text office stays. The desktop app shows it.",
    }
  }
  if (verb === 'route') return { text: await routeText($, cfg, arg) }
  if (verb === 'departments') {
    if (cfg.departments.length === 0) return { text: 'No departments set. Add them in /config → agent-office → Departments.' }
    await scanBuilding($, cfg, false).catch(() => undefined)
    const [b, selfId] = await Promise.all([read($, building).then(x => normalize(DEFAULT_BUILDING, x)), $.session.id().catch(() => '')])
    return { text: rosterText(cfg.departments, b.live, selfId, b.live.find(s => s.sessionId === selfId)?.name ?? '') }
  }
  if (verb === 'usage') return { text: await usageText($, arg).catch(() => 'The usage log is not readable in this session.') }
  if (verb === 'layout') {
    const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
    if (!layout) return { text: 'Usage: /office layout auto|compact|wide|mini' }
    await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
    const opened = await openPane($)
    return { text: opened.isPlaced ? `Agent Office layout: ${layout}.` : `Layout set to ${layout}; the pane is not shown yet: ${opened.reason}` }
  }
  const opened = await openPane($)
  if (!opened.isPlaced) return { text: `Agent Office is not shown yet: ${opened.reason}` }
  return { text: 'Agent Office opened. Focus it with ctrl+x tab; 1-6 expand cards, f/s/o open the gate rows.' }
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // The pixel office's motion lives here, not in state: where each person was, and who's walking.
  const WALK_MS = 1500
  const seenZone = new Map<string, Person['zone']>()
  const walking = new Map<string, { from: Person['zone']; to: Person['zone']; start: number }>()
  let shown: { people: Person[]; columns: number; rows: number } | null = null
  const pixelFrame = (people: Person[], now: number) => {
    for (const p of people) {
      const was = seenZone.get(p.id)
      if (was !== undefined && was !== p.zone) walking.set(p.id, { from: was, to: p.zone, start: now })
      seenZone.set(p.id, p.zone)
    }
    const walks = new Map<string, Walk>()
    for (const [id, w] of walking) {
      const t = (now - w.start) / WALK_MS
      if (t >= 1) walking.delete(id)
      else walks.set(id, { from: w.from, to: w.to, t })
    }
    return base64(encodePng(drawOffice(people, walks, Math.floor(now / 400))))
  }
  // The department office (pixel mode with departments): its director keeps the actors between frames.
  const director = newDirector()
  // The cell size: measured from the terminal (auto), or the one set in /config. Until a measurement
  // lands, assume a large Retina cell: the terminal then shrinks the picture rather than leave a gap.
  const cellSet = cfg.cellPx.trim().toLowerCase() === 'auto' ? null : parseCell(cfg.cellPx)
  const FALLBACK_CELL = { w: 16, h: 34 }
  let lastCols = 0
  let shownDept: { input: DeptInput; scale: number; aw: number; cols: number; rows: number; width: number; height: number } | null = null
  const deptFrame = (input: DeptInput, now: number, box: { scale: number; aw: number; width: number; height: number }) => {
    setLayout(box.aw)
    const { scene, moving } = direct(director, input, now)
    const art = drawScene(scene, Math.floor(now / 83), now)
    return { png: base64(encodePngRgb(box.width, box.height, scaleInto(art, box.scale, box.width, box.height))), moving }
  }
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'office',
      description: 'Agent Office, the live agent dashboard: open, close, reset, or set the layout',
      argumentHint: '[open|close|reset|building|office|pixel [on|off]|departments|route auto|off|light|standard|heavy|usage today|week|layout auto|compact|wide|mini]',
    })
    // The upstream name, kept so muscle memory from Flightdeck still works.
    await $.command.register({
      name: 'flightdeck',
      description: 'Alias of /office',
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
    // Pixel office: does this terminal show inline pictures? A guess from its environment; drawing one confirms it.
    const [TERM, TERM_PROGRAM, TMUX, KITTY_WINDOW_ID, GHOSTTY_RESOURCES_DIR, WEZTERM_EXECUTABLE] = await Promise.all([
      $.env.get('TERM'),
      $.env.get('TERM_PROGRAM'),
      $.env.get('TMUX'),
      $.env.get('KITTY_WINDOW_ID'),
      $.env.get('GHOSTTY_RESOURCES_DIR'),
      $.env.get('WEZTERM_EXECUTABLE'),
    ])
    const images = termShowsImages({ TERM, TERM_PROGRAM, TMUX, KITTY_WINDOW_ID, GHOSTTY_RESOURCES_DIR, WEZTERM_EXECUTABLE })
    term.images = images
    await update($, pixelEnv, x => ({ images, denied: x?.denied ?? false, cell: x?.cell ?? null }))
    if (images && !cellSet) void measureCell($).catch(() => undefined)
    // While the pixel office is up and something moves, swap in a fresh frame about four times a second.
    $.clock.every(250, async () => {
      if (!shown || !shown.people.some(p => p.mood === 'ok' || walking.has(p.id))) return
      const now = await $.clock.now()
      const r = await $.ui.blit({ requestId: PANE, key: 'office-px', source: { png: pixelFrame(shown.people, now) }, columns: shown.columns, rows: shown.rows })
      if (r.deny) {
        shown = null
        // Drawing its alt: this terminal can't show the picture, so the text office comes back.
        if (/alt|placeholder|image/i.test(r.deny)) await update($, pixelEnv, x => ({ images: x?.images ?? false, denied: true }))
      }
    })
    // The department office: about twelve frames a second while anyone moves, three when all is still.
    let deptTick = 0
    $.clock.every(83, async () => {
      if (!shownDept) return
      deptTick += 1
      const now = await $.clock.now()
      const s = shownDept
      const { png, moving } = deptFrame(s.input, now, s)
      if (!moving && deptTick % 4 !== 0) return
      const r = await $.ui.blit({ requestId: PANE, key: 'office-dept', source: { png }, columns: s.cols, rows: s.rows })
      if (r.deny) {
        shownDept = null
        if (/alt|placeholder|image/i.test(r.deny)) await update($, pixelEnv, x => ({ images: x?.images ?? false, denied: true }))
      }
    })
    // Every 2 s: the whole building while it's on screen (history only when it changed); otherwise
    // just the running sessions, when there are departments to staff.
    $.clock.every(2000, async () => {
      const isBuilding = normalize(DEFAULT_VIEW, await read($, view)).scene === 'building'
      if (isBuilding || cfg.departments.length > 0) await scanBuilding($, cfg, isBuilding).catch(() => undefined)
    })
    void pruneUsage($).catch(() => undefined)
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        costUsd: u.cost?.usd ?? null,
        limits: u.rateLimits.map(limitOf),
      }))
    }
    if (cfg.openOnStart) void openPane($).catch(() => undefined)
    await refreshStatus($, cfg)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      lastRepo = ''
      await resetAll($)
      await refreshStatus($, cfg)
    }
    return next(e)
  })

  on('command.run', { command: 'office' }, ($, e) => runOffice($, cfg, e.args))
  on('command.run', { command: 'flightdeck' }, ($, e) => runOffice($, cfg, e.args))

  // Handing a task to the supervisor: it reads which department sessions are running right now.
  // The roster rides in the command's arguments, which the playbook's prompt carries to the model.
  on('command.run', async ($, e, next) => {
    if (!/(^|:)assign$/.test(e.command) || cfg.departments.length === 0) return next(e)
    await scanBuilding($, cfg, false).catch(() => undefined)
    const [b, selfId] = await Promise.all([read($, building).then(x => normalize(DEFAULT_BUILDING, x)), $.session.id().catch(() => '')])
    const hqName = b.live.find(s => s.sessionId === selfId)?.name ?? ''
    const staffed = cfg.departments.filter(d => desksOf(d, b.live, selfId).some(k => k.session)).length
    await say($, 'supervisor', `${staffed} of ${cfg.departments.length} departments on call`, 'consult')
    return next({ ...e, args: `${e.args}\n\n<departments>\n${rosterText(cfg.departments, b.live, selfId, hqName)}\n</departments>` })
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  })

  on('turn.start', async ($, e, next) => {
    const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const back = e.text ? handbackOf(e.text) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    } else if (e.text) {
      const p = promptLine(e.text)
      const cross = crossMessageOf(e.text)
      if (cross) {
        const at = await $.clock.now()
        const list = listOf<Dispatch>(await read($, dispatches))
        const done = list.find(x => x.to === cross.fromName && x.status === 'sent')
        if (done) {
          await update($, dispatches, l => answerDispatch(listOf<Dispatch>(l), cross.fromName, cross.body, at))
          $.ui.toast(`✓ ${done.dept} finished${done.repo ? ` (${done.repo})` : ''}: ${cross.body}`, { timeoutMs: 8000 })
        }
        await say($, cross.fromName || 'peer', `replied: ${cross.body}`, 'done')
      } else await say($, p.who, p.text)
      // Only what you typed is routed; the engine's own turns carry on as they were.
      await update($, route, x => ({ ...normalize(DEFAULT_ROUTE, x), pending: p.who === 'you' ? e.text ?? null : null }))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      // Time the response as it passes: the first piece that is not the engine's envelope, then the
      // stop chunk. Two clock reads in the stream and nothing stored until it has ended.
      const sentAt = await $.clock.now()
      let firstAt: number | null = null
      let stopAt: number | null = null
      // The supervisor: decide on the prompt you typed at the turn's first request (the session's own
      // model and effort are known here), then send every step of the turn on the chosen ones.
      const base = { model: e.model, effort: typeof e.effort === 'string' ? e.effort : null }
      const pending = (await getRoute($)).pending
      if (pending !== null) {
        await update($, route, x => ({ ...normalize(DEFAULT_ROUTE, x), pending: null }))
        await supervise($, cfg, pending, base, sentAt)
      }
      await update($, route, x => ({ ...normalize(DEFAULT_ROUTE, x), base, lastStepAt: sentAt }))
      const r = await getRoute($)
      const routed = modeOf(r, cfg) === 'off' ? e : { ...e, ...applyTarget(r.current, e) }
      // This step writes (or reads) the cache of the model and effort it runs on.
      const ctxNow = (await getUsage($)).tokens ?? 0
      const key = cacheKey({ model: routed.model, effort: typeof routed.effort === 'string' ? routed.effort : null }, base)
      await update($, route, x => {
        const y = normalize(DEFAULT_ROUTE, x)
        return { ...y, warm: { ...(y.warm ?? {}), [key]: { at: sentAt, tokens: ctxNow } } }
      })
      // The main box shows what the step actually runs on.
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, model: routed.model, effort: String(routed.effort ?? x.effort), steps: x.steps + 1 }
      })
      const s = next(routed)
      for await (const c of s) {
        if (c.kind === 'stop') stopAt = await $.clock.now()
        else if (firstAt === null && c.kind !== 'engine') firstAt = await $.clock.now()
        yield c
      }
      const result = await s.result
      const speed = result.usage && stopAt !== null ? stepSpeed(sentAt, firstAt, stopAt, result.usage.output_tokens) : null
      if (speed) await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), speed }))
      return result
    }
    const result = yield* next(e)
    const id = e.agentId
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
      if (result.stopReason === 'max_tokens') await say($, await whoIs($, id), 'hit max_tokens', 'error', id)
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, x => ({
      ...normalize(DEFAULT_USAGE, x),
      pct: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      costUsd: e.cost?.usd ?? null,
      limits: e.rateLimits.map(limitOf),
    }))
    // Budget and context alerts: one toast per threshold crossed, never repeated this session.
    const fired = listOf<string>((await read($, alerts))?.fired)
    const costUsd = e.cost?.usd ?? null
    const crossed = crossedAlerts(fired, { costUsd, contextPct: e.context.percent ?? null }, cfg)
    if (crossed.alerts.length > 0) {
      await update($, alerts, () => ({ fired: crossed.fired }))
      for (const al of crossed.alerts) {
        const text = alertText(al, { costUsd, budgetUsd: cfg.costBudgetUsd })
        $.ui.toast(text, { timeoutMs: 8000 })
        await say($, al.kind === 'cost' ? 'accounts' : 'facilities', text, 'error')
      }
    }
    if (e.changed.includes('context') || e.changed.includes('cost')) await refreshStatus($, cfg)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, usage, x => {
        const u = normalize(DEFAULT_USAGE, x)
        return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
      })
      await say($, 'main', `context compacted (${e.trigger})`)
    }
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await say($, 'gate', `denied by rule · ${check.detail}`, 'error')
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    // The office: the worker sets off for this call's room before it runs, and stays there after.
    const who = e.agentId ?? 'main'
    const isErrand = String(e.tool) !== 'SubagentHandback'
    if (isErrand) {
      const errand = { tool: e.tool, text: shorten(describeInput(e.tool, e), 64), toolUseId: e.tool_use_id, at: await $.clock.now() }
      await update($, errands, x => startErrand(normalizeErrands(x), who, errand))
    }
    const room = ROOM_OF[zoneOf(e.tool)] ?? 'desk'
    if (isErrand) {
      const cwd = await $.session.cwd().catch(() => '')
      const repo = repoOfCall(cwd, e, await subfolders($, cwd))
      if (repo) lastRepo = repo
    }
    if (isErrand) void writeStatus($, room, shorten(describeInput(e.tool, e), 40)).catch(() => undefined)
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    const didRun = ran.deny === undefined
    if (isErrand) await update($, errands, x => finishErrand(normalizeErrands(x), who, e.tool_use_id, !didRun || ran.isError === true))
    if (isErrand && room === 'server' && ran.isError === true) void writeStatus($, room, shorten(describeInput(e.tool, e), 40), true).catch(() => undefined)
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    if (String(e.tool) === 'SendMessage' && !e.agentId && didRun && ran.isError !== true) {
      const input = e as unknown as { to?: unknown; message?: unknown }
      const to = typeof input.to === 'string' ? input.to.replace(/\s*\[[0-9a-f]+\]$/i, '') : ''
      const message = typeof input.message === 'string' ? input.message : ''
      const b = normalize(DEFAULT_BUILDING, await read($, building))
      const where = deptOfSession(cfg.departments, b.live, to)
      if (to && where) {
        const task = shorten(message.split('\n').map(l => l.replace(/^task from hq:\s*/i, '').trim()).find(Boolean) ?? '', 140)
        const repo = repoInText(message, reposIn(cfg.departments.find(x => x.label === where.label)?.handles ?? ''))
        const d: Dispatch = { to, dept: where.label, folder: where.folder, task, ...(repo ? { repo } : {}), at: await $.clock.now(), status: 'sent' }
        await update($, dispatches, l => [...listOf<Dispatch>(l), d].slice(-30))
        await say($, 'supervisor', `→ ${where.label} (${to}): ${task}`, 'consult')
      }
    }
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    if (ran.deny !== undefined) await say($, await whoIs($, e.agentId), `${text}  denied`, 'error', e.agentId ?? null)
    else if (hasFailed) await say($, await whoIs($, e.agentId), `${text}  ✗`, 'error', e.agentId ?? null)
    else if (isEdit) await say($, await whoIs($, e.agentId), text, 'info', e.agentId ?? null)
    if (isSettled || !didRun) await refreshStatus($, cfg)
    return ran
  })

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, `${block.name} tool`)
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => [...listOf<unknown>(list).map(normalizeCard), card].slice(-24))
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    await say($, shorten(cardTitle(card), 12), `spawned · ${card.type}`, 'info', id)
    // A handoff: research that finished this turn goes on to whoever builds or documents next.
    const role = roleOf(card.type)
    if (role === 'engineering' || role === 'docs') {
      const [all, t] = await Promise.all([getCards($), getTurn($)])
      const names = namesFor(all.map(c => c.id))
      const from = all.filter(c => c.id !== id && c.status === 'done' && (c.endedAt ?? 0) >= t.startedAt && roleOf(c.type) !== role)
      if (from.length > 0) {
        await say($, 'supervisor', `handed ${from.map(c => `${names.get(c.id)}'s ${roleOf(c.type)}`).join(' + ')} to ${names.get(id)} (${role})`, 'consult', id)
      }
    }
    await refreshStatus($, cfg)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    const now = await $.clock.now()
    if (!id) {
      const [t, cards, cost] = await Promise.all([getTurn($), getCards($), costNow($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        costNow: cost,
        reason: e.reason,
      })
      await update($, receipt, () => r)
      await logUsage($, r.agents).catch(() => undefined)
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      void writeStatus($, 'desk', '').catch(() => undefined)
      // The manager walks back to the desk between turns.
      await update($, errands, x => Object.fromEntries(Object.entries(normalizeErrands(x)).filter(([k]) => k !== 'main')))
      await refreshStatus($, cfg)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    if (cards.some(c => c.id === id)) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(e.answer, 400) } : c)),
      )
      const card = cards.find(c => c.id === id)
      const took = card ? fmtDuration(now - card.spawnedAt) : ''
      await say($, await whoIs($, id), status === 'done' ? `done · ${took}` : status, status === 'done' ? 'done' : 'error', id)
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const hasClient = 'Client' in els
    const [m, u, a, g, cards, lp, lines, t, r, v, now, errs, rt, bld, selfId, sent, pxEnv] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getLog($),
      getTurn($),
      read($, receipt),
      getView($),
      $.clock.now(),
      read($, errands).then(normalizeErrands),
      getRoute($),
      read($, building).then(b => normalize(DEFAULT_BUILDING, b)),
      $.session.id().catch(() => ''),
      read($, dispatches).then(x => listOf<Dispatch>(x)),
      read($, pixelEnv),
    ])
    const W = Math.max(40, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = cfg.motion && hasClient
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const people = officeScene({ cards, errands: errs, gate: g, isRunning: m.isRunning, isAdvising: advising, architectLabel: cfg.architectLabel })
    const isEmpty: Record<Panel, boolean> = {
      office: false,
      main: false,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      receipt: !m.isRunning && !r,
      log: false,
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    const decider = m.mode === 'auto' ? 'classifier' : 'you'

    // A connector between panels: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: C.faint, marks, isMerge }}
        />
      ) : (
        <Text color={C.faint}>{'─'.repeat(Math.max(1, width))}</Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClient ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    // ---- office: the main loop as the manager, subagents as staff, each in the room of their errand
    const atWork = people.filter(p => p.mood === 'ok' || p.mood === 'waiting').length
    const isBuilding = v.scene === 'building'
    const sceneButton = (
      <Button
        key="scene"
        plain
        hotkey="b"
        label={isBuilding ? 'office ▸' : 'building ▸'}
        onPress={async () => {
          const scene: 'office' | 'building' = isBuilding ? 'office' : 'building'
          await update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), scene }))
          if (!isBuilding) await scanBuilding($, cfg).catch(() => undefined)
        }}
      />
    )

    // ---- building: every session on this machine, a floor per project, the closed ones gone home
    const bs = buildingScene({ live: bld.live, past: bld.past, selfId })
    const PER_FLOOR = 4
    const buildingRows = () => {
      const perRow = 3
      let rows = 3
      for (let i = 0; i < bs.floors.length; i += perRow) {
        rows += 3 + Math.min(PER_FLOOR, Math.max(1, ...bs.floors.slice(i, i + perRow).map(f => f.people.length)))
      }
      return rows + (bs.gone.length > 0 ? 3 + bs.gone.length : 0)
    }
    const buildingPanel = (w: number) => {
      const perRow = w >= 90 ? 3 : w >= 60 ? 2 : 1
      const floorW = Math.floor((w - (perRow - 1)) / perRow)
      const rows: (typeof bs.floors)[] = []
      for (let i = 0; i < bs.floors.length; i += perRow) rows.push(bs.floors.slice(i, i + perRow))
      return (
        <Box flexDirection="column" width={w}>
          <Box justifyContent="space-between" width={w}>
            <Text bold wrap="truncate">{`building · ${bld.live.length} running · ${bs.busy} busy · ${bs.gone.length} gone home`}</Text>
            {sceneButton}
          </Box>
          <Text wrap="truncate">
            <Text color={C.main}>☻ you  </Text>
            <Text color={C.agent}>☺ ⠿ busy  </Text>
            <Text color={C.dim}>☺ z idle (for how long)</Text>
          </Text>
          {bld.scannedAt === 0 ? <Text color={C.faint}>looking around the building…</Text> : null}
          {bld.problem ? <Text color={C.amber} wrap="truncate">{bld.problem}</Text> : null}
          {rows.map(row => {
            const most = Math.min(PER_FLOOR, Math.max(1, ...row.map(f => f.people.length)))
            return (
              <Box columnGap={1}>
                {row.map(f => (
                  <Box key={`floor-${f.cwd}`} flexDirection="column" borderStyle="round" borderColor={f.people.some(p => p.isBusy) ? C.main : C.faint} paddingX={1} width={floorW} height={3 + most}>
                    <Text color={C.dim} bold wrap="truncate">
                      {f.project}
                    </Text>
                    {f.people.slice(0, PER_FLOOR).map(p => (
                      <Text wrap="truncate" color={p.isBusy ? (p.isSelf ? C.main : C.agent) : C.dim}>
                        {`${p.isSelf ? '☻' : '☺'} ${p.isBusy ? '⠿' : `z ${agoOf(p.since, now)}`} ${p.title}${p.isSelf ? ' (here)' : ''}${p.kind === 'bg' ? ' · bg' : ''}`}
                      </Text>
                    ))}
                    {f.people.length > PER_FLOOR ? <Text color={C.faint}>{`+${f.people.length - PER_FLOOR} more`}</Text> : null}
                  </Box>
                ))}
              </Box>
            )
          })}
          {bs.gone.length > 0 ? (
            <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} width={w}>
              <Text color={C.dim} bold>{`gone home · last ${3} days`}</Text>
              {bs.gone.map(p => (
                <Text wrap="truncate">
                  <Text color={C.text}>{`${projectOf(p.cwd).padEnd(18).slice(0, 18)} `}</Text>
                  <Text color={C.faint}>{`${agoOf(p.lastAt, now).padStart(8)} ago  `}</Text>
                  <Text color={C.dim}>{p.lastPrompt || p.firstPrompt || `${plural(p.prompts, 'command')} only`}</Text>
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    }

    // ---- org chart: the supervisor and the teammates they handed work to
    const team = teamOf(people, W >= 80 ? 4 : W >= 56 ? 3 : 2)
    const roleColor = (role?: string) =>
      role === 'research' ? C.arch : role === 'engineering' ? C.agent : role === 'docs' ? C.cleared : role === 'review' ? C.amber : C.dim
    const statusText = (p: (typeof people)[number]) =>
      p.mood === 'waiting' ? '? needs you' : p.status === 'running' ? `⠿ ${roomLabel(p.zone).toLowerCase()}` : p.status === 'done' ? '✓ done' : `✗ ${p.status ?? 'stopped'}`
    const supervisorModel = rt.base ? prettyModel(rt.current.model ?? rt.base.model) : modelName
    // Departments: each one's desks (running sessions), busiest first, and the last task it was given.
    // Only an HQ, a session that has handed work out, draws the departments; the departments themselves don't.
    const depts = (sent.length > 0 ? cfg.departments : []).map(d => {
      const desks = desksOf(d, bld.live, selfId)
      const staffed = desks.filter(k => k.session)
      const busy = staffed.find(k => k.session?.status === 'busy')
      const last = [...sent].reverse().find(x => x.dept === d.label)
      return { d, desk: busy ?? staffed[0] ?? null, staffed: staffed.length, open: desks.length, last }
    })
    const deptRow = (w: number) => {
      const colW = Math.floor(w / Math.max(1, depts.length))
      return (
        <Box width={w}>
          {depts.map(x => {
            const s = x.desk?.session
            const state = !s ? '○ not open' : x.desk?.isSelf ? '☻ here (HQ)' : s.status === 'busy' ? '⠿ busy' : `z idle ${agoOf(s.updatedAt, now)}`
            const task = x.last ? (x.last.status === 'replied' ? `✓ ${x.last.reply ?? 'replied'}` : `→ ${x.last.task}`) : ''
            return (
              <Box key={`dept-${x.d.label}`} flexDirection="column" alignItems="center" width={colW}>
                <Text color={s ? C.text : C.faint} bold wrap="truncate">{x.d.label}</Text>
                <Text color={!s ? C.faint : s.status === 'busy' ? C.agent : C.dim} wrap="truncate">{state}</Text>
                <Text color={C.faint} wrap="truncate">{s ? `${s.name}${x.open > 1 ? ` +${x.staffed - 1}/${x.open - 1}` : ''}` : x.d.folders.join(', ')}</Text>
                <Text color={x.last?.status === 'replied' ? C.gate : C.amber} wrap="truncate">{task}</Text>
              </Box>
            )
          })}
        </Box>
      )
    }
    const orgChart = (w: number) =>
      team.length === 0 && depts.length === 0 ? null : (
        <Box flexDirection="column" width={w}>
          <Box justifyContent="center" width={w}>
            <Text color={C.main} bold>{`☻ Claude · ${depts.length > 0 ? 'HQ supervisor' : 'supervisor'}`}</Text>
            <Text color={C.dim}>{` · ${supervisorModel}${m.isRunning ? ' · working' : ''}`}</Text>
          </Box>
          {depts.length > 0 ? <Text color={C.faint}>{orgLine(w, depts.length)}</Text> : null}
          {depts.length > 0 ? deptRow(w) : null}
          {team.length > 0 && depts.length > 0 ? <Text color={C.dim}>{'team (subagents)'}</Text> : null}
          {team.length > 0 ? <Text color={C.faint}>{orgLine(w, team.length)}</Text> : null}
          {team.length === 0 ? null : <Box width={w}>
            {team.map(p => {
              const colW = Math.floor(w / team.length)
              return (
                <Box key={`org-${p.id}`} flexDirection="column" alignItems="center" width={colW}>
                  <Text color={colorOfPerson(p)} bold wrap="truncate">{`☺ ${p.name}`}</Text>
                  <Text color={roleColor(p.role)} wrap="truncate">{p.role ?? 'staff'}</Text>
                  <Text color={p.mood === 'waiting' ? C.amber : p.status === 'running' ? C.agent : p.status === 'done' ? C.gate : C.warn} wrap="truncate">
                    {statusText(p)}
                  </Text>
                  <Text color={C.dim} wrap="truncate">{p.task ?? ''}</Text>
                </Box>
              )
            })}
          </Box>}
        </Box>
      )
    function colorOfPerson(p: (typeof people)[number]) {
      return p.mood === 'waiting' ? C.amber : p.mood === 'oops' ? C.warn : p.mood === 'done' ? C.gate : C.agent
    }

    // ---- pixel floor: the same office as pixel art, an Image in terminals that show pictures, an
    // SVG on the other surfaces; null keeps the text office (opted out, or no pictures here)
    const isPixel = (v.style ?? term.style ?? cfg.officeStyle) === 'pixel'
    // After /clear the store starts empty: the terminal's facts come from the mod's own memory.
    const px = { images: Boolean(pxEnv?.images || term.images), denied: pxEnv?.denied ?? false, cell: pxEnv?.cell ?? term.cell }
    const nextStyle: 'text' | 'pixel' = isPixel ? 'text' : 'pixel'
    // The department office: a person per department, HQ in the middle, rooms on top.
    const folderOfCwd = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? ''
    const deptInput = (): DeptInput => {
      const selfLive = bld.live.find(s => s.sessionId === selfId)
      const selfIsDept = cfg.departments.some(d => desksOf(d, bld.live, selfId).some(k => k.isSelf))
      const hqLive = bld.live.find(s => folderOfCwd(s.cwd) === 'hq') ?? (selfIsDept ? undefined : selfLive)
      const stateOf = (s: LiveSession | undefined | null) => (!s ? 'closed' : s.sessionId === selfId ? (m.isRunning ? 'busy' : 'idle') : s.status === 'busy' ? 'busy' : 'idle') as SlotInfo['state']
      const slots: SlotInfo[] = [{ slot: HQ_SLOT, label: 'HQ', look: 'hq', state: stateOf(hqLive), dispatch: null, zone: null, isError: false }]
      cfg.departments.slice(0, 5).forEach((d, i) => {
        const desks = desksOf(d, bld.live, selfId).filter(k => k.session)
        const desk = desks.find(k => (k.isSelf ? m.isRunning : k.session?.status === 'busy')) ?? desks[0]
        const st = desk?.session ? bld.status?.[desk.session.sessionId] : undefined
        const zone = st && (ROOM_ZONES as readonly string[]).includes(st.zone) ? (st.zone as RoomZone) : null
        const job = sent.find(x => x.dept === d.label && x.status === 'sent') ?? [...sent].reverse().find(x => x.dept === d.label) ?? null
        const repo = (desk?.session?.status === 'busy' ? st?.repo : undefined) ?? (job?.status === 'sent' ? job.repo : undefined) ?? null
        slots.push({ slot: [0, 2, 3, 4, 5][i]!, label: d.label, look: lookOf(d.label), state: stateOf(desk?.session), dispatch: job, zone, isError: st?.isError ?? false, repo, activity: st?.text ? activityOf(st.text) : null })
      })
      const t = new Date(now)
      return { slots, hour: t.getHours(), minute: t.getMinutes() }
    }
    // Names and states are on the desks' own plates; under the picture, the work board: what each
    // department is on, in which repo, what it's doing right now, and what waits behind it.
    const deptBoard = (input: DeptInput, w: number) => {
      const items = boardOf(
        input.slots.filter(x => x.slot !== HQ_SLOT).map(x => ({ label: x.label, isBusy: x.state === 'busy', repo: x.repo ?? null, activity: x.activity ?? null })),
        sent,
        now,
      )
      if (items.length === 0) return null
      const inner = Math.max(10, w - 4)
      return (
        <Box flexDirection="column" width={w}>
          {items.map(it =>
            it.kind === 'done' ? (
              <Text key={`board-${it.label}`} color={C.gate} wrap="truncate">{`✓ ${it.label}${it.repo ? ` · ${it.repo}` : ''} · ${shorten(it.reply, Math.max(10, w - it.label.length - 18))} (${agoOf(it.at, now)} ago)`}</Text>
            ) : (
              <Box key={`board-${it.label}`} flexDirection="column" borderStyle="round" borderColor={it.isBusy ? C.amber : C.faint} paddingX={1} width={w}>
                <Box justifyContent="space-between" width={inner}>
                  <Text wrap="truncate">
                    <Text color={C.text} bold>{it.label}</Text>
                    <Text color={C.dim}>{it.repo ? ` · ${it.repo}` : ''}</Text>
                  </Text>
                  <Text color={C.faint}>{agoOf(it.since, now)}</Text>
                </Box>
                <Text color={C.amber} wrap="wrap">{shorten(it.task, inner * 2 - 2)}</Text>
                <Box justifyContent="space-between" width={inner}>
                  <Text color={it.isBusy ? C.agent : C.dim} wrap="truncate">{it.isBusy ? `▸ ${it.activity ?? 'thinking'}` : '… waiting to start'}</Text>
                  <Text color={C.amber}>{it.queued > 0 ? ` +${it.queued} queued` : ''}</Text>
                </Box>
              </Box>
            ),
          )}
        </Box>
      )
    }
    const deptFloor = (w: number) => {
      const input = deptInput()
      if (e.surface === 'terminal') {
        if (!px.images || px.denied || !('Image' in els)) {
          shownDept = null
          return null
        }
        const cell = cellSet ?? px.cell ?? FALLBACK_CELL
        if (!cellSet && lastCols !== w) {
          lastCols = w
          void measureCell($).catch(() => undefined)
        }
        const box = pixelBox(w, cell.w, cell.h)
        shownDept = { input, ...box }
        const { Image } = els
        return (
          <Box flexDirection="column" width={w}>
            <Image key="office-dept" source={{ png: deptFrame(input, now, box).png }} columns={box.cols} rows={box.rows} alt={input.slots.map(s => `${s.label} ${s.state}`).join(' · ')} />
            {deptBoard(input, w)}
          </Box>
        )
      }
      shownDept = null
      if (!('Svg' in els)) return null
      const { Svg } = els
      const png = deptFrame(input, now, { scale: 2, aw: ART_W, width: ART_W * 2, height: ART_H * 2 }).png
      return (
        <Box flexDirection="column" width={w}>
          <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W * 3}" height="${ART_H * 3}" viewBox="0 0 ${ART_W * 2} ${ART_H * 2}"><image href="data:image/png;base64,${png}" width="${ART_W * 2}" height="${ART_H * 2}" style="image-rendering:pixelated"/></svg>`} alt="department office" width={ART_W * 3} height={ART_H * 3} />
          {deptBoard(input, w)}
        </Box>
      )
    }
    const pixelFloor = (w: number) => {
      if (!isPixel || isBuilding) {
        shown = null
        shownDept = null
        return null
      }
      if (cfg.departments.length > 0) {
        shown = null
        return deptFloor(w)
      }
      shownDept = null
      const caption = (
        <Box flexDirection="column" width={w}>
          {[...people]
            .sort((x, y) => (y.mood === 'waiting' ? 1 : 0) - (x.mood === 'waiting' ? 1 : 0))
            .slice(0, 5)
            .map(p => (
              <Text wrap="truncate">
                <Text color={p.mood === 'waiting' ? C.amber : p.isBoss ? C.main : C.agent} bold>{`${p.name}${p.role && p.role !== 'staff' ? ` (${p.role})` : ''} ▸ ${roomLabel(p.zone)}: `}</Text>
                <Text color={C.dim}>{p.quip}</Text>
              </Text>
            ))}
        </Box>
      )
      if (e.surface === 'terminal') {
        if (!px.images || px.denied || !('Image' in els)) {
          shown = null
          return null
        }
        const columns = Math.min(255, w)
        const rows = rowsFor(columns)
        shown = { people, columns, rows }
        const { Image } = els
        return (
          <Box flexDirection="column" width={w}>
            <Image key="office-px" source={{ png: pixelFrame(people, now) }} columns={columns} rows={rows} alt={officeLine(people, w)} />
            {caption}
          </Box>
        )
      }
      shown = null
      if (!('Svg' in els)) return null
      const { Svg } = els
      const pxW = 480
      const pxH = Math.round((pxW * 88) / 160)
      const png = pixelFrame(people, now)
      return (
        <Box flexDirection="column" width={w}>
          <Svg
            source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 160 88"><image href="data:image/png;base64,${png}" width="160" height="88" style="image-rendering:pixelated"/></svg>`}
            alt={officeLine(people, 120)}
            width={pxW}
            height={pxH}
          />
          {caption}
        </Box>
      )
    }

    const officePanel = (w: number) => {
      if (isBuilding) return buildingPanel(w)
      const floor = pixelFloor(w)
      // In the department office the picture is the org chart; the text one would only repeat it.
      const showOrg = !(floor && cfg.departments.length > 0)
      return (
      <Box flexDirection="column" width={w}>
        <Box justifyContent="space-between" width={w}>
          <Text bold>{`office · ${atWork} at work`}</Text>
          <Box columnGap={2}>
            <Button key="style" plain hotkey="p" label={isPixel ? 'text ▸' : 'pixel ▸'} onPress={() => {
              term.style = nextStyle
              return update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), style: nextStyle }))
            }} />
            {sceneButton}
          </Box>
          {people.some(p => p.mood === 'waiting') ? <Text color={C.amber}>someone needs your signature</Text> : null}
        </Box>
        {modeOf(rt, cfg) !== 'off' && rt.last ? (
          <Text wrap="truncate">
            <Text color={C.arch} bold>{'model '}</Text>
            <Text color={C.dim}>{`${rt.last.tier} (${rt.last.why}) ${rt.last.note}`}</Text>
          </Text>
        ) : null}
        {showOrg ? orgChart(w) : null}
        {/* The text office has no picture to hang the board under: it follows the org chart. */}
        {showOrg && cfg.departments.length > 0 && sent.length > 0 ? deptBoard(deptInput(), w) : null}
        {floor ?? (hasClient ? (
          <els.Client
            key="office"
            module="./office.tsx"
            width={w}
            height={officeRows(people)}
            props={{
              width: w,
              motion: cfg.motion,
              rooms: [...ROOMS],
              people,
              colors: { wall: C.faint, label: C.dim, boss: C.main, staff: C.agent, waiting: C.amber, oops: C.warn, done: C.gate, floor: C.faint, text: C.text, dim: C.dim },
            }}
          />
        ) : (
          people.map(p => (
            <Text wrap="truncate">
              <Text color={p.isBoss ? C.main : C.agent} bold>{`${p.isBoss ? '☻' : '☺'} ${p.name} ▸ ${roomLabel(p.zone)}  `}</Text>
              <Text color={C.dim}>{p.quip}</Text>
            </Text>
          ))
        ))}
      </Box>
    )
    }

    // ---- main
    const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
    const ctxGauge = u.pct !== null ? gauge(u.pct, 10) : null
    const mainPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.main} paddingX={1} width={w}>
        <Box justifyContent="space-between">
          <Text color={C.main} bold>
            {modelName} · main
          </Text>
          <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? '● working' : '○ idle'}</Text>
        </Box>
        <Text wrap="truncate">
          <Text dimColor>effort </Text>
          <Text color={C.main}>{'▮'.repeat(effortN) + '▯'.repeat(4 - effortN)} </Text>
          <Text color={C.main} bold>
            {m.effort || '—'}
          </Text>
          {m.mode ? <Text dimColor>{`   mode ${m.mode}`}</Text> : null}
          <Text dimColor>{`   ${m.steps} req`}</Text>
        </Text>
        {ctxGauge ? (
          <Text wrap="truncate">
            <Text dimColor>ctx </Text>
            <Text color={u.pct !== null && u.pct >= 80 ? C.warn : C.main}>{ctxGauge.on}</Text>
            <Text color={C.faint}>{ctxGauge.off}</Text>
            <Text bold>{` ${Math.round(u.pct ?? 0)}%`}</Text>
            {u.tokens !== null ? <Text dimColor>{` ${kTokens(u.tokens)}/${kTokens(u.window)}`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{`  ⟲${u.compactions}`}</Text> : null}
          </Text>
        ) : null}
        {u.costUsd !== null || u.limits.length > 0 ? (
          <Text wrap="truncate">
            {u.costUsd !== null ? <Text color={C.text}>{`${fmtUsd(u.costUsd)}   `}</Text> : null}
            {u.limits.slice(0, 2).map(l => {
              const lg = gauge(l.pct, 5)
              // The time to each reset where the line has room for it: both windows fit from 56 columns,
              // so a wide pane's half column (59 at 120) has them and a 40-column pane keeps its gauges.
              const resetIn = w >= 56 ? fmtResetIn(l.resetsAt, now) : ''
              return (
                <Text wrap="truncate">
                  <Text dimColor>{`${limitLabel(l.kind)} `}</Text>
                  <Text color={l.pct >= 80 ? C.warn : C.main}>{lg.on}</Text>
                  <Text color={C.faint}>{lg.off}</Text>
                  <Text dimColor>{` ${Math.round(l.pct)}%${resetIn ? ` ↻${resetIn}` : ''}  `}</Text>
                </Text>
              )
            })}
          </Text>
        ) : null}
        {m.speed ? <Text dimColor wrap="truncate">{`last req  ${fmtSpeed(m.speed)}`}</Text> : null}
      </Box>
    )

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    const architectPanel = (w: number) => {
      const tl = consultTimeline(a, now, Math.max(8, w - 4))
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.arch} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.arch} bold>
              {cfg.architectLabel} · {advising ? 'advising' : 'on call'}
            </Text>
            <Text>
              <Text dimColor>consults </Text>
              <Text color={C.arch} bold>
                {a.consults.length}
              </Text>
            </Text>
          </Box>
          <Text color={C.arch}>{tl}</Text>
          {lastConsult ? (
            <Text dimColor wrap="truncate">
              {advising
                ? `consulting since ${fmtClock(lastConsult.at)}`
                : `last ${fmtDuration(now - (lastConsult.endAt ?? lastConsult.at))} ago · took ${fmtDuration((lastConsult.endAt ?? now) - lastConsult.at)}`}
            </Text>
          ) : (
            <Text dimColor>not consulted yet</Text>
          )}
          {cfg.moments ? (
            <Box flexWrap="wrap" columnGap={2}>
              {(['before a plan', 'error repeats', 'before done'] as const).map(mo => {
                const isOn = lastConsult?.moment === mo
                return (
                  <Text color={isOn ? C.arch : C.dim} bold={isOn}>
                    {isOn ? '◆' : '◇'} {mo}
                  </Text>
                )
              })}
              <Text color={C.faint}>(inferred)</Text>
            </Box>
          ) : null}
          {a.lastAdvice ? (
            <Text color={C.arch} wrap="truncate">
              » {a.lastAdvice}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- gate
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    const gatePanel = (w: number) => {
      const strip = g.recent.slice(-Math.max(8, w - 4))
      const open = v.gateOpen
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gate} paddingX={1} width={w}>
          <Box justifyContent="space-between">
            <Text color={C.gate} bold>
              {cfg.gateLabel} · permissions
            </Text>
            <Text dimColor>{`${s.total} checks`}</Text>
          </Box>
          <Box>
            {strip.length === 0 ? <Text color={C.faint}>no checks yet</Text> : null}
            {strip.map(c => (
              <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                {c.verdict === 'deny' ? '✗' : '■'}
              </Text>
            ))}
          </Box>
          <Text wrap="truncate">
            <Text color={C.gate}>■</Text>
            <Text dimColor>{` ${s.rule} allowed  `}</Text>
            <Text color={C.cleared}>■</Text>
            <Text dimColor>{` ${s.cleared} ${decider}  `}</Text>
            {s.ask > 0 ? <Text color={C.amber}>{`■ ${s.ask} pending  `}</Text> : null}
            <Text color={s.deny > 0 ? C.warn : C.dim}>{`✗ ${s.deny} denied`}</Text>
            {w >= 80 && g.recent.some(c => c.inSubagent) ? <Text color={C.faint}>{'  dim: in subagents'}</Text> : null}
          </Text>
          <Box columnGap={2}>
            {(['file', 'shell', 'other'] as const).map((b: Bucket) => {
              const tl = g.totals[b]
              const n = tl.rule + tl.ask + tl.cleared + tl.deny
              return (
                <Button
                  key={`gate-${b}`}
                  plain
                  hotkey={b[0]}
                  label={`${b} ${n}${open === b ? ' ▾' : ''}`}
                  dimColor={n === 0}
                  onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
                />
              )
            })}
          </Box>
          {open
            ? g.recent
                .filter(c => c.bucket === open)
                .slice(-5)
                .map(c => (
                  <Text wrap="truncate">
                    <Text color={verdictColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text>
                    <Text color={C.dim}>{`${(c.verdict === 'rule' ? 'allowed' : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? 'pending' : 'denied').padEnd(10)} `}</Text>
                    <Text dimColor={c.inSubagent}>{shorten(c.detail, Math.max(10, w - 18))}</Text>
                  </Text>
                ))
            : null}
        </Box>
      )
    }

    // ---- agents: cards up to the limit, swimlanes beyond it
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.gate : C.agent)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    const agentsPanel = (w: number) => {
      // Cards need 20 columns each; when the pane can't hold the limit, lanes take over.
      const fit = Math.max(1, Math.min(cfg.maxCards, Math.floor((w + 1) / 21)))
      const useLanes = cards.length > fit
      const header = (
        <Box justifyContent="space-between" width={w}>
          <Text bold>{`agents · ${running.length} running · ${cards.length} total`}</Text>
          {cards.length > 0 ? <Text color={C.faint}>1-{Math.min(cards.length, useLanes ? 6 : fit)} expand</Text> : null}
        </Box>
      )
      if (cards.length === 0) {
        return (
          <Box flexDirection="column" width={w}>
            {header}
            <Text color={C.faint}>no subagents yet</Text>
          </Box>
        )
      }
      if (useLanes) {
        const shown = cards.slice(-6)
        const barW = Math.max(8, w - 28)
        const geo = lanes(shown, now, barW)
        return (
          <Box flexDirection="column" width={w}>
            {header}
            {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} earlier`}</Text> : null}
            {shown.map((c, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              return (
                <Box>
                  <Text color={statusColor(c)} bold={isViewed}>{`${isViewed ? '▶' : glyph(c)} `}</Text>
                  <Box width={17}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), 14)} onPress={expandOnPress(c.id)} />
                  </Box>
                  <Text color={C.faint}>{' ' + '·'.repeat(gm?.before ?? 0)}</Text>
                  <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                  <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0) + ' '}</Text>
                  {clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                </Box>
              )
            })}
          </Box>
        )
      }
      const shown = cards.slice(-fit)
      const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
      const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
      return (
        <Box flexDirection="column" width={w}>
          {header}
          {rail('fan-out', running.length > 0, C.agent, w, centers)}
          <Box columnGap={1}>
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              const sameModel = !c.model || prettyModel(c.model) === modelName
              return (
                <Box
                  flexDirection="column"
                  borderStyle={isViewed ? 'double' : 'round'}
                  borderColor={c.lastStop === 'max_tokens' ? C.warn : C.agent}
                  borderDimColor={c.status !== 'running' && !isViewed}
                  width={cardW}
                  paddingX={1}
                >
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={titleLines(cardTitle(c), cardW - 7, cardW - 4)[0]} onPress={expandOnPress(c.id)} />
                  <Text bold wrap="truncate">
                    {titleLines(cardTitle(c), cardW - 7, cardW - 4)[1]}
                  </Text>
                  <Text color={C.dim} wrap="truncate">
                    {sameModel ? c.type : `${c.type} · ${prettyModel(c.model)}`}
                  </Text>
                  <Text dimColor wrap="truncate">
                    {c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${c.steps} st` : 'starting…'}
                  </Text>
                  <Box>
                    <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>
                      {cardW >= 26 ? `${glyph(c)} ${c.lastStop === 'max_tokens' ? 'max_tokens' : c.status} ` : `${glyph(c)} `}
                    </Text>
                    <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
          {rail('merge', running.length > 0, C.agent, w, centers, true)}
        </Box>
      )
    }

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Text bold wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          <Text dimColor wrap="truncate">{`${expandedCard.type} · ${prettyModel(expandedCard.model)} · ${expandedCard.status} · ${expandedCard.steps} steps`}</Text>
          {expandedCard.tools.length === 0 ? <Text color={C.faint}>no tool calls yet</Text> : null}
          {expandedCard.tools.map(n => (
            <Text color={n.isError ? C.warn : C.text} wrap="truncate">
              {`${n.isError ? '✗' : '·'} ${n.text}`}
            </Text>
          ))}
          {expandedCard.answer ? (
            <Text dimColor wrap="wrap">
              {`» ${shorten(expandedCard.answer, 240)}`}
            </Text>
          ) : null}
        </Box>
      ) : null

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const active = lp.filter(l => isLoopActive(l, now)).length
      const dots = lp.slice(-Math.max(4, w - 38))
      return (
        <Box width={w}>
          <Text bold>other loops </Text>
          <Text dimColor>{`${lp.length} seen · ${active} active  `}</Text>
          {dots.map(l => (
            <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
          ))}
        </Box>
      )
    }

    // ---- receipt: the turn now, or the last one
    const receiptPanel = (w: number) => {
      const isReview = t.isReviewing
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.main} borderDimColor={!m.isRunning && !isReview} paddingX={1} width={w}>
          {m.isRunning ? (
            <Box>
              <Text color={C.main} wrap="truncate">{`◐ back to ${modelName.toLowerCase()} · turn `}</Text>
              <Box flexShrink={0}>{clock('turn-clock', t.startedAt, null, C.main)}</Box>
              {w >= 60 ? <Text dimColor wrap="truncate">{` · ${plural(t.edits, 'edit')} · ${plural(t.errors, 'error')}`}</Text> : null}
            </Box>
          ) : r ? (
            <Text wrap="truncate">
              <Text color={r.reason === 'answer' ? C.gate : C.warn}>{r.reason === 'answer' ? '✓ ' : '✗ '}</Text>
              <Text>{`last turn ${fmtDuration(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}`}</Text>
              {r.costDelta !== null ? <Text color={C.main}>{` · +${fmtUsd(r.costDelta)}`}</Text> : null}
            </Text>
          ) : (
            <Text color={C.faint}>no turn finished yet</Text>
          )}
          {isReview ? <Text color={C.arch}>{`${cfg.architectLabel.toLowerCase()} reviewing before done (inferred)`}</Text> : null}
        </Box>
      )
    }

    // ---- log: whatever rows the other panels leave, 4 to 8
    // The main box's speed line and the gap above the log are a row each.
    const used = (panels.includes('office') ? (isBuilding ? buildingRows() : 2 + officeRows(people) + (team.length > 0 || depts.length > 0 ? 2 : 0) + (depts.length > 0 ? 4 : 0) + (team.length > 0 ? 5 : 0)) : 0) + 2 + 5 + (m.speed ? 1 : 0) + 1 + (showArchitect ? 6 : 0) + 6 + (v.gateOpen ? 5 : 0) + (cards.length > cfg.maxCards ? 3 + Math.min(6, cards.length) : 8) + (expandedCard ? 8 : 0) + (lp.length ? 1 : 0) + 3
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const nLog = logRows(bodyRows, used)
    const shownLines = (viewed ? lines.filter(l => l.agentId === viewed) : lines).slice(-nLog)
    const colorOf = (l: LogLine) =>
      l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent
    const logPanel = (w: number) => (
      <Box flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} marginTop={1} width={w}>
        <Text dimColor>{viewed ? 'session log · this agent' : 'session log'}</Text>
        {shownLines.length === 0 ? <Text color={C.faint}>nothing yet</Text> : null}
        {shownLines.map(l => (
          <Box>
            <Box width={9} flexShrink={0}>
              <Text color={C.faint}>{fmtClock(l.at)}</Text>
            </Box>
            <Box width={13} flexShrink={0}>
              <Text color={colorOf(l)} bold wrap="truncate">
                {l.who}
              </Text>
            </Box>
            <Text color={l.kind === 'error' ? C.warn : C.text} wrap="truncate">
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const draw = (p: Panel, w: number) =>
      p === 'office'
        ? officePanel(w)
        : p === 'main'
        ? mainPanel(w)
        : p === 'architect'
          ? architectPanel(w)
          : p === 'gate'
            ? gatePanel(w)
            : p === 'agents'
              ? agentsPanel(w)
              : p === 'loops'
                ? loopsPanel(w)
                : p === 'receipt'
                  ? receiptPanel(w)
                  : logPanel(w)

    // Panels with the flow between them; the agents panel draws its own rails.
    const column = (ps: Panel[], w: number) => (
      <Box flexDirection="column" width={w}>
        {ps.map((p, i) => {
          const prev = ps[i - 1]
          const link =
            i === 0 || p === 'office' || prev === 'office' || p === 'agents' || prev === 'agents' || p === 'log' || p === 'loops' || prev === 'loops'
              ? null
              : rail(`link-${p}`, p === 'architect' ? advising : m.isRunning, p === 'architect' ? C.arch : C.main, w)
          return (
            <Box flexDirection="column">
              {link}
              {draw(p, w)}
              {p === 'agents' ? expandedPanel(w) : null}
            </Box>
          )
        })}
      </Box>
    )

    // Desktop draws the agents' time axis as SVG under the panels.
    const svgLanes =
      e.surface !== 'terminal' && cards.length > 0
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            const rowH = 18
            const pxW = 520
            const geo = lanes(cards.slice(-10), now, 100)
            const rects = cards
              .slice(-10)
              .map((c, i) => {
                const gm = geo[i]
                const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
                const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
                const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
                const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
                return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
              })
              .join('')
            const svgH = Math.min(10, cards.length) * rowH + 4
            return (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
                alt={`${cards.length} agents on a time axis`}
                width={pxW}
                height={svgH}
              />
            )
          })()
        : null

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    if (isMini) {
      // Eight rows at most: with the office line, the loops line and the last turn all shown, one agent row gives way.
      const isCrowded = panels.includes('office') && lp.length > 0 && !m.isRunning && r !== null
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, isCrowded ? 2 : 3)
      const counts = ` ${s.rule} allowed · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} pending` : ''} · ${s.deny} denied`
      const strip = g.recent.slice(-Math.max(4, W - cfg.gateLabel.length - 1 - counts.length))
      const mg = u.pct !== null ? gauge(u.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          <Text wrap="truncate">
            <Text color={C.main} bold>
              {modelName}
            </Text>
            <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? ' ● working' : ' ○ idle'}</Text>
            {mg ? <Text dimColor> · ctx </Text> : null}
            {mg ? <Text color={(u.pct ?? 0) >= 80 ? C.warn : C.main}>{mg.on}</Text> : null}
            {mg ? <Text color={C.faint}>{mg.off}</Text> : null}
            {mg ? <Text>{` ${Math.round(u.pct ?? 0)}%`}</Text> : null}
            {u.compactions > 0 ? <Text color={C.amber}>{` ⟲${u.compactions}`}</Text> : null}
            {u.costUsd !== null ? <Text dimColor>{` · ${fmtUsd(u.costUsd)}`}</Text> : null}
            {showArchitect ? <Text color={C.arch}>{` · ${cfg.architectLabel.toLowerCase()} ${advising ? 'advising' : a.consults.length}`}</Text> : null}
          </Text>
          {panels.includes('office') ? (
            <Text color={people.some(p => p.mood === 'waiting') ? C.amber : C.dim} wrap="truncate">
              {officeLine(people, W)}
            </Text>
          ) : null}
          {strip.length > 0 ? (
            <Box>
              <Text dimColor>{`${cfg.gateLabel.toLowerCase()} `}</Text>
              {strip.map(c => (
                <Text color={verdictColor(c)} dimColor={c.inSubagent}>
                  {c.verdict === 'deny' ? '✗' : '■'}
                </Text>
              ))}
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box>
              <Text color={statusColor(c)}>{`${glyph(c)} `}</Text>
              <Box width={Math.max(10, W - 30)}>
                <Text wrap="truncate">{cardTitle(c)}</Text>
              </Box>
              <Text dimColor>{c.steps > 0 ? ` ctx ${kTokens(c.ctx)} ` : ' '}</Text>
              {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.faint} wrap="truncate">{`+${cards.length - live.length} more agents · /office layout compact for all`}</Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor>{`other loops ${lp.length} · ${lp.filter(l => isLoopActive(l, now)).length} active`}</Text> : null}
          {!m.isRunning && r ? (
            <Text dimColor wrap="truncate">
              {`last turn ${fmtDuration(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}${r.costDelta !== null ? ` · +${fmtUsd(r.costDelta)}` : ''}`}
            </Text>
          ) : null}
        </Box>
      )
    }

    const legend = fitLegend(
      [
        { label: 'main', color: C.main },
        { label: 'agents', color: C.agent },
        { label: cfg.gateLabel.toLowerCase(), color: C.gate },
        ...(showArchitect ? [{ label: cfg.architectLabel.toLowerCase(), color: C.arch }] : []),
      ],
      W,
    )

    const body = isWide ? (
      <Box flexDirection="column">
        {panels.includes('office') ? officePanel(W) : null}
        <Box columnGap={2}>
          {column(panels.filter(p => p === 'main' || p === 'architect' || p === 'gate'), colW)}
          {column(panels.filter(p => p === 'agents' || p === 'loops' || p === 'receipt'), colW)}
        </Box>
        {panels.includes('log') ? logPanel(W) : null}
      </Box>
    ) : (
      column(panels, W)
    )

    return (
      <Box flexDirection="column" width={W}>
        <Box justifyContent="center">
          <Text bold wrap="truncate">
            <Text>AGENT OFFICE</Text>
            <Text color={C.dim}> · </Text>
            <Text color={C.main}>{modelName.toUpperCase()}</Text>
            <Text>{m.isRunning ? ' WORKS' : ' IDLE'}</Text>
            {showArchitect ? <Text color={C.dim}> · </Text> : null}
            {showArchitect ? <Text color={C.arch}>{cfg.architectLabel}</Text> : null}
            {showArchitect ? <Text>{advising ? ' ADVISING' : ' ON CALL'}</Text> : null}
          </Text>
        </Box>
        <Box justifyContent="center" columnGap={2}>
          {legend.map(l => (
            <Text>
              <Text color={l.color}>■</Text>
              <Text dimColor>{` ${l.label}`}</Text>
            </Text>
          ))}
        </Box>
        {body}
        {svgLanes}
      </Box>
    )
  })
}
