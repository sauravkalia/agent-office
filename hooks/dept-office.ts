// The department office's director: turns live facts (which department sessions run, what HQ sent
// them, what they replied, which room their status file says they're in) into a scene. It keeps
// the actors between frames; no `$` here, so the choreography is testable with a fake clock.
import type { Dispatch } from '../types'
import { HQ_SLOT, ROOM_ZONES, advance, briefErrands, eveningOf, forSlot, newActor, replyErrands, walkerOf } from './pixel2-core'
import type { Actor, BubbleKind, Desk, DeskState, Look, RoomZone, Scene, Walker } from './pixel2-core'

/** What the render hook knows about one desk. */
export type SlotInfo = {
  slot: number
  label: string
  look: Look
  state: DeskState
  /** The newest task HQ handed this department, if any. */
  dispatch: Dispatch | null
  /** The room its session's status file names, when that session is busy there. */
  zone: RoomZone | null
  isError: boolean
}

export type DeptInput = { slots: SlotInfo[]; hour: number; minute: number }

export type Director = {
  actors: Map<number, Actor>
  seen: Map<number, string>
  bubbles: Map<number, { kind: BubbleKind | null; since: number }>
  roomSince: Map<number, number>
  briefDone: Map<number, string>
}

export const newDirector = (): Director => ({ actors: new Map(), seen: new Map(), bubbles: new Map(), roomSince: new Map(), briefDone: new Map() })

const isRoom = (z: string | null): z is RoomZone => z !== null && (ROOM_ZONES as readonly string[]).includes(z)

/** Old news isn't replayed: a dispatch or reply older than this when first seen just sets the scene. */
const FRESH_MS = 30_000

/** One step: take in new facts, move the actors to `now`, and describe the frame. */
export const direct = (d: Director, input: DeptInput, now: number): { scene: Scene; moving: boolean } => {
  const walkers: Walker[] = []
  const away = new Set<number>()
  let hqStanding = false
  let briefSlide: number | null = null
  let tray = false
  let confettiSince: number | null = null
  const rooms: Scene['rooms'] = []
  for (const s of input.slots) {
    if (s.slot === HQ_SLOT) continue
    let a = d.actors.get(s.slot) ?? newActor(s.slot, s.look)
    if (a.look !== s.look) a = { ...a, look: s.look }
    // A new dispatch or reply: the walk to HQ.
    const key = s.dispatch ? `${s.dispatch.at}|${s.dispatch.status}` : ''
    const was = d.seen.get(s.slot)
    if (key && key !== was) {
      const when = s.dispatch!.status === 'replied' ? (s.dispatch!.endedAt ?? s.dispatch!.at) : s.dispatch!.at
      const fresh = was !== undefined || now - when < FRESH_MS
      if (fresh && s.state !== 'closed') a = { ...a, queue: [...a.queue, ...forSlot(s.dispatch!.status === 'replied' ? replyErrands() : briefErrands(), s.slot)] }
      d.seen.set(s.slot, key)
    }
    // Between errands: go where the session is working, or back to the desk.
    const want = isRoom(s.zone) && s.state === 'busy' ? ({ kind: 'room', zone: s.zone } as const) : ({ kind: 'desk', slot: s.slot } as const)
    const there = a.at.kind === want.kind && (want.kind !== 'room' || (a.at.kind === 'room' && a.at.zone === want.zone))
    if (a.queue.length === 0 && !a.trip) {
      if (a.stay && a.stay.tag === 'work' && !there) a = { ...a, stay: null }
      if (!a.stay && !there) a = { ...a, queue: [{ to: want, stayMs: want.kind === 'room' ? 600_000 : 0, tag: want.kind === 'room' ? 'work' : undefined }] }
    }
    const before = a
    a = advance(a, now)
    if (before.at.kind !== 'room' && a.at.kind === 'room') d.roomSince.set(s.slot, now)
    if (before.stay?.tag === 'brief' && !a.stay && s.dispatch) d.briefDone.set(s.slot, `${s.dispatch.at}`)
    d.actors.set(s.slot, a)
    const w = walkerOf(a, now)
    if (w) walkers.push(w)
    if (w || a.at.kind !== 'desk') away.add(s.slot)
    if (a.stay?.tag === 'brief') {
      hqStanding = true
      briefSlide = Math.max(0, Math.min(1, 1 - (a.stay.until - now) / 1600))
    }
    if (a.stay?.tag === 'drop') {
      tray = true
      confettiSince = a.stay.until - 1800
    }
    if (a.at.kind === 'room' && !a.trip) rooms.push({ zone: a.at.zone, since: d.roomSince.get(s.slot) ?? now, flash: a.at.zone === 'server' && s.isError ? 'fail' : undefined })
  }
  const desks: Desk[] = input.slots.map(s => {
    const recentReply = s.dispatch?.status === 'replied' && now - (s.dispatch.endedAt ?? s.dispatch.at) < 15 * 60_000
    const hqSent = s.slot === HQ_SLOT && input.slots.some(o => o.dispatch?.status === 'sent' && now - o.dispatch.at < 5_000)
    const kind: BubbleKind | null =
      s.state === 'closed' ? null : hqSent ? 'sent' : s.dispatch?.status === 'sent' ? (s.slot === HQ_SLOT ? 'busy' : 'sent') : recentReply ? 'reply' : s.state === 'busy' ? 'busy' : 'idle'
    const b = d.bubbles.get(s.slot)
    if (!b || b.kind !== kind) d.bubbles.set(s.slot, { kind, since: now })
    const paper = s.dispatch?.status === 'sent' && d.briefDone.get(s.slot) === `${s.dispatch.at}`
    return { slot: s.slot, look: s.look, state: s.state, bubble: kind, bubbleSince: d.bubbles.get(s.slot)!.since, paper }
  })
  if (tray === false && input.slots.some(s => s.dispatch?.status === 'replied' && now - (s.dispatch.endedAt ?? 0) < 60_000)) tray = true
  const scene: Scene = { desks, walkers, away, hqStanding, briefSlide, tray, confettiSince, rooms, evening: eveningOf(input.hour + input.minute / 60), clock: { h: input.hour, m: input.minute } }
  const moving = walkers.length > 0 || desks.some(x => x.state === 'busy') || confettiSince !== null || rooms.length > 0
  return { scene, moving }
}
