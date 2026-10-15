export type Moment = 'before a plan' | 'error repeats' | 'before done'

export type Bucket = 'file' | 'shell' | 'other'

/** rule: settings allowed it. ask: put to the decider, outcome pending. cleared: asked, then ran. deny: refused. */
export type Verdict = 'rule' | 'ask' | 'cleared' | 'deny'

export type Main = {
  model: string
  effort: string
  mode: string
  steps: number
  isRunning: boolean
  /** The main loop's last answered request: time to its first piece of response, and output tokens
   *  per second from that piece to the stop. Null until one is measured, absent in older state. */
  speed?: { ttftMs: number; tokPerS: number | null } | null
}

export type Usage = {
  pct: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  /** `resetsAt`: when the window resets, in ms since the epoch; null when the API gave no time,
   *  absent in state saved before it was kept. */
  limits: { kind: string; pct: number; resetsAt?: number | null }[]
  compactions: number
  lastCompactAt: number | null
}

export type Consult = { id: string; at: number; endAt: number | null; moment: Moment; via: string }

export type Architect = { consults: Consult[]; ids: string[]; seen: string[]; lastAdvice: string }

export type Check = {
  id: string
  tool: string
  bucket: Bucket
  verdict: Verdict
  inSubagent: boolean
  detail: string
  at: number
}

export type Tally = { rule: number; ask: number; cleared: number; deny: number }

export type Gate = { recent: Check[]; totals: Record<Bucket, Tally> }

export type ToolNote = { tool: string; text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  /** Output tokens summed over its steps. */
  out: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
}

/** A model loop whose id matches no card: a workflow agent, a compaction or a memory fork. */
export type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }

export type LogLine = {
  at: number
  who: string
  text: string
  agentId: string | null
  kind: 'info' | 'error' | 'consult' | 'done'
}

export type Turn = {
  edits: number
  errorStreak: number
  errors: number
  isReviewing: boolean
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
}

export type Layout = 'auto' | 'compact' | 'wide' | 'mini'

export type View = {
  expanded: string | null
  gateOpen: Bucket | null
  layout: Layout | null
  /** Which picture the office panel draws: this session's office, or every session in the building. */
  scene?: 'office' | 'building'
  /** How the office floor is drawn this session: the text rooms, or pixel art; absent, the configured `officeStyle`. */
  style?: 'text' | 'pixel'
}

/** A running session, from Claude Code's session registry. */
export type LiveSession = { sessionId: string; name: string; cwd: string; status: string; kind: string; updatedAt: number }

/** A session with prompts in the history window, running or not. */
export type PastSession = { sessionId: string; cwd: string; firstPrompt: string; lastPrompt: string; firstAt: number; lastAt: number; prompts: number }

/** A task the supervisor handed to a department's session, and what came back. */
export type Dispatch = {
  /** The session name it went to. */
  to: string
  dept: string
  folder: string
  task: string
  at: number
  status: 'sent' | 'replied'
  reply?: string
  endedAt?: number
}

/** What the last scan of the machine found. */
export type Building = { live: LiveSession[]; past: PastSession[]; scannedAt: number; historyMtime: number; problem: string | null }

export type Roster = { architectTypes: string[] }

/** The office rooms a worker can be in. */
export type Zone = 'desk' | 'archives' | 'warehouse' | 'workshop' | 'server' | 'meeting' | 'hr' | 'coffee'

/** A worker's current tool call: set as it starts, kept (done) until the next one replaces it. */
export type Errand = { tool: string; text: string; toolUseId: string; at: number; isError: boolean; isDone: boolean }

/** Each worker's errand, keyed by agent id; `main` is the main loop. */
export type Errands = Record<string, Errand>

/** The supervisor's state: what the main loop runs on now, and what it decided last. */
export type Route = {
  /** Set by `/office route` for this session: auto routes each prompt, off leaves the session alone, a tier pins it. null: the configured `routing`. */
  override: 'auto' | 'off' | 'light' | 'standard' | 'heavy' | null
  /** null model or effort: the session's own. */
  current: { model: string | null; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null }
  /** The session's own model and effort, as the engine names them before the supervisor's rewrite. */
  base: { model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null } | null
  lastStepAt: number
  /** The prompt you just typed, decided on at the turn's first request (when the session model is known). */
  pending: string | null
  last: { tier: string; why: string; note: string; isSwitch: boolean } | null
  savedUsd: number
  switches: number
}

/** One person in the office drawing. */
export type Person = {
  id: string
  name: string
  zone: Zone
  mood: 'ok' | 'idle' | 'waiting' | 'oops' | 'done'
  isBoss: boolean
  quip: string
  /** The teammate's job, from their agent type: research, engineering, docs, review, planning; staff otherwise. */
  role?: string
  /** The task the supervisor gave them, for the org chart. */
  task?: string
  /** Their card's status: running, done, failed, stopped. */
  status?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      meta: { schemaVersion: number }
      main: Main
      usage: Usage
      architect: Architect
      gate: Gate
      agents: AgentCard[]
      loops: Loop[]
      log: LogLine[]
      turn: Turn
      receipt: Receipt | null
      view: View
      roster: Roster
      errands: Errands
      alerts: { fired: string[] }
      sessionDay: { day: string }
      route: Route
      building: Building
      dispatches: Dispatch[]
      /** Can this terminal show inline pictures: guessed from its environment, then confirmed by drawing one. */
      pixelEnv: { images: boolean; denied: boolean }
    }
  }
}
