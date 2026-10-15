// The supervisor, as pure data: which tier a prompt needs, and whether moving the main loop to
// that tier's model and effort is worth it. Every change re-caches the conversation (the prompt
// cache is per model, and a new effort invalidates it too), so a downgrade must save more than
// the re-cache costs; an upgrade is taken for quality and its cost reported.
import { fmtUsd, kTokens, prettyModel } from './core'

export type Tier = 'light' | 'standard' | 'heavy'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** What the main loop runs on. `model: null` is the session's own model, `effort: null` its own effort. */
export type Target = { model: string | null; effort: Effort | null }
export const SESSION: Target = { model: null, effort: null }

// ---------------------------------------------------------------- classify

const ACK = /^(y|ya|yes|yep|yeah|ok(ay)?|sure|go( ahead)?|do it|continue|proceed|carry on|thanks?|thank you|thx|lgtm|sounds good|great|nice|cool|perfect)[\s.!]*$/i
const HEAVY =
  /\b(architect\w*|design|plan|refactor\w*|migrat\w*|rewrite|debug\w*|investigat\w*|root cause|race|deadlock|perf(ormance)?|optimi[sz]\w*|secur\w*|vulnerab\w*|review|audit|implement\w*|build (a|an|the|me|out)|feature|across|entire|whole|codebase|end[- ]to[- ]end|complex|tricky|why (is|does|did|do|are))\b/i
const LIGHT_START =
  /^(what|where|which|who|when|is|are|does|do|can|show|list|print|run|explain|rename|fix (the |a |this )?typo|format|lint|commit|push|git|ls|cat|open|read|check|how (many|much|do i))\b/i
const TRACE = /```|Traceback|\bat .+:\d+:\d+|\bError:|Exception\b/

/** A prompt's tier and why, from its words alone: no model call, no tokens. */
export const classify = (text: string, o: { isPlanMode?: boolean } = {}): { tier: Tier | 'continue'; why: string } => {
  const t = text.trim()
  if (o.isPlanMode) return { tier: 'heavy', why: 'plan mode' }
  // "yes, do it", "ok go ahead": every comma-separated piece a go-ahead.
  if (t.length <= 40 && t.split(/[,;]+/).every(piece => ACK.test(piece.trim()))) return { tier: 'continue', why: 'a go-ahead keeps the current setup' }
  const heavy = HEAVY.exec(t)?.[0]
  if (t.length > 800) return { tier: 'heavy', why: 'long brief' }
  if (TRACE.test(t)) return { tier: 'heavy', why: 'code or a stack trace' }
  if (heavy) return { tier: 'heavy', why: `"${heavy.toLowerCase()}"` }
  if (t.length <= 160 && !t.includes('\n') && LIGHT_START.test(t)) return { tier: 'light', why: 'quick question' }
  return { tier: 'standard', why: 'everyday task' }
}

// ---------------------------------------------------------------- prices

type Price = { input: number; output: number; read: number; window: number }

/** $/MTok by family (Claude API list prices); unknown models price as the session's tier, Opus. */
export const priceOf = (model: string): Price =>
  /haiku/i.test(model)
    ? { input: 1, output: 5, read: 0.1, window: 200_000 }
    : /sonnet/i.test(model)
      ? { input: 2, output: 10, read: 0.2, window: 1_000_000 }
      : /fable|mythos/i.test(model)
        ? { input: 10, output: 50, read: 0.25, window: 1_000_000 }
        : { input: 4, output: 20, read: 0.2, window: 1_000_000 }

/** Claude Code's prompt cache lives an hour: an hour's cache write costs twice the input price. */
const WRITE = 2
const OUT_PER_STEP = 800
const STEPS: Record<Tier, number> = { light: 3, standard: 8, heavy: 15 }
const EFFORT_OUT: Record<Effort, number> = { low: 0.5, medium: 0.75, high: 1, xhigh: 1.3, max: 1.7 }
const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

const family = (model: string) => /haiku/i.exec(model)?.[0] ?? /sonnet/i.exec(model)?.[0] ?? /opus/i.exec(model)?.[0] ?? model
export const sameFamily = (a: string, b: string) => family(a).toLowerCase() === family(b).toLowerCase()

// ---------------------------------------------------------------- decide

export type SupervisorConfig = { lightModel: string; heavyModel: string; lightEffort: Effort; heavyEffort: Effort }

/** The target a tier asks for, in the session's own model id where the family matches (keeps its cache and its [1m]). */
export const targetOf = (tier: Tier, base: { model: string }, cfg: SupervisorConfig): Target => {
  if (tier === 'standard') return SESSION
  const model = tier === 'light' ? cfg.lightModel : cfg.heavyModel
  const effort = tier === 'light' ? cfg.lightEffort : cfg.heavyEffort
  return { model: sameFamily(model, base.model) ? null : model, effort }
}

const resolve = (t: Target, base: { model: string; effort: Effort | null }) => ({ model: t.model ?? base.model, effort: t.effort ?? base.effort ?? 'high' })

export type Decision = { next: Target; isSwitch: boolean; note: string; costUsd: number; savingUsd: number }

export const decide = (o: {
  tier: Tier
  current: Target
  base: { model: string; effort: Effort | null }
  ctxTokens: number
  isCacheWarm: boolean
  isPinned: boolean
  cfg: SupervisorConfig
}): Decision => {
  const want = targetOf(o.tier, o.base, o.cfg)
  const cur = resolve(o.current, o.base)
  const tgt = resolve(want, o.base)
  const label = `${prettyModel(tgt.model)}${/haiku/i.test(tgt.model) ? '' : ` (${tgt.effort})`}`
  if (cur.model === tgt.model && cur.effort === tgt.effort) return { next: o.current, isSwitch: false, note: `stays on ${label}`, costUsd: 0, savingUsd: 0 }

  const pc = priceOf(cur.model)
  const pt = priceOf(tgt.model)
  const ctx = Math.max(0, o.ctxTokens)
  if (ctx > pt.window * 0.8) {
    return { next: o.current, isSwitch: false, note: `kept ${prettyModel(cur.model)}: ${kTokens(ctx)} of context won't fit ${prettyModel(tgt.model)}`, costUsd: 0, savingUsd: 0 }
  }
  // A warm cache is lost by the switch; a cold one is rewritten anyway, so only the price gap counts.
  const costUsd = Math.max(0, (o.isCacheWarm ? ctx * pt.input * WRITE : ctx * (pt.input - pc.input) * WRITE) / 1e6)
  const steps = STEPS[o.tier]
  const savingUsd = (steps * (ctx * (pc.read - pt.read) + OUT_PER_STEP * (pc.output * EFFORT_OUT[cur.effort] - pt.output * EFFORT_OUT[tgt.effort]))) / 1e6
  const isUpgrade = pt.output > pc.output || (pt.output === pc.output && EFFORT_RANK[tgt.effort] > EFFORT_RANK[cur.effort])

  if (o.isPinned || isUpgrade || savingUsd > costUsd) {
    const why = o.isPinned ? 'pinned' : isUpgrade ? (costUsd >= 0.01 ? `re-cache ~${fmtUsd(costUsd)}` : 'for quality') : `saves ~${fmtUsd(savingUsd - costUsd)}`
    return { next: want, isSwitch: true, note: `→ ${label} · ${why}`, costUsd, savingUsd: isUpgrade ? 0 : savingUsd - costUsd }
  }
  return {
    next: o.current,
    isSwitch: false,
    note: `kept ${prettyModel(cur.model)}: switching re-caches ${kTokens(ctx)} (~${fmtUsd(costUsd)}) to save ~${fmtUsd(Math.max(0, savingUsd))}`,
    costUsd: 0,
    savingUsd: 0,
  }
}

/** A target for this step's request: the step's own model and effort when the target leaves them be. */
export const applyTarget = (t: Target, step: { model: string; effort?: Effort | number }) => ({
  model: t.model ?? step.model,
  effort: t.effort ?? step.effort,
})
