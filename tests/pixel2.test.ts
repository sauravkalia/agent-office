import { expect, test } from 'claude-code/testing'

import { encodePngRgb } from '../hooks/png-core'
import {
  AH,
  AW,
  HQ_SLOT,
  advance,
  along,
  briefErrands,
  colorAt,
  drawScene,
  eveningOf,
  forSlot,
  lookOf,
  newActor,
  parseCell,
  pathBetween,
  pixelBox,
  replyErrands,
  scaleInto,
  slotOrigin,
  walkerOf,
} from '../hooks/pixel2-core'
import type { Desk, Scene } from '../hooks/pixel2-core'

const desks = (): Desk[] =>
  (['pr', 'hq', 'sphere', 'social', 'daily', 'quilt'] as const).map((look, slot) => ({ slot, look, state: slot === 5 ? 'closed' : 'busy', bubble: null, bubbleSince: 0, paper: false }))
const scene = (over: Partial<Scene> = {}): Scene => ({
  desks: desks(),
  walkers: [],
  away: new Set(),
  hqStanding: false,
  briefSlide: null,
  tray: false,
  confettiSince: null,
  rooms: [],
  evening: 0,
  clock: { h: 10, m: 0 },
  ...over,
})

test('department names map to their people', () => {
  expect(['PR Review', 'Sphere Dev', 'Quilt Discussion', 'Social', 'Daily Dose', 'Backend'].map(lookOf)).toEqual(['pr', 'sphere', 'quilt', 'social', 'daily', 'sphere'])
})

test('the picture fits whole cells, so the terminal never resamples it', () => {
  expect(pixelBox(72, 7, 17)).toEqual({ scale: 3, cols: 72, rows: 27, width: 504, height: 459 })
  const b = pixelBox(100, 8, 18)
  expect(b.scale).toBe(4)
  expect(b.width % 8).toBe(0)
  expect(b.height % 18).toBe(0)
  expect(b.width).toBeGreaterThanOrEqual(AW * 4)
  expect(parseCell('7x17')).toEqual({ w: 7, h: 17 })
  expect(parseCell(' 10 × 22 ')).toEqual({ w: 10, h: 22 })
  expect(parseCell('nonsense')).toEqual({ w: 7, h: 17 })
})

test('scaling is whole pixels: each art pixel becomes a solid block', () => {
  const f = drawScene(scene(), 0, 0)
  const rgb = scaleInto(f, 3, AW * 3, AH * 3)
  const at = (x: number, y: number) => [...rgb.subarray((y * AW * 3 + x) * 3, (y * AW * 3 + x) * 3 + 3)]
  for (const [x, y] of [[10, 10], [80, 60], [150, 120]] as const) {
    const c = colorAt(f, x, y)
    for (const [dx, dy] of [[0, 0], [2, 2], [1, 2]]) expect(at(x * 3 + dx!, y * 3 + dy!)).toEqual([...c])
  }
})

test('rooms carry their signs; the evening dims the floor and lights the lamps', () => {
  const day = drawScene(scene(), 0, 0)
  const eve = drawScene(scene({ evening: 1 }), 0, 0)
  expect([...colorAt(day, 1, 1)]).toEqual([0xcd, 0xb4, 0xdb])
  expect(colorAt(day, 50, 86).join()).not.toBe(colorAt(eve, 50, 86).join())
  expect([eveningOf(10), eveningOf(17), eveningOf(20), eveningOf(3)]).toEqual([0, 0.5, 1, 1])
})

test('a visitor to HQ stands beside the boss, never on top of them', () => {
  const hq = slotOrigin(HQ_SLOT)
  const pts = pathBetween({ kind: 'desk', slot: 2 }, { kind: 'hq' })
  for (let k = 0; k <= 1; k += 0.05) {
    const p = along(pts, k)
    if (p.y > hq.y) expect(p.x).toBeGreaterThanOrEqual(hq.x + 34)
  }
  // To the second row and the rooms, the path stays on corridors and ends at the place.
  const toRoom = pathBetween({ kind: 'desk', slot: 4 }, { kind: 'room', zone: 'warehouse' })
  expect(along(toRoom, 1)).toMatchObject({ x: 57, y: 14 })
})

test('a brief: walk to HQ, stay, carry the paper home; a reply: carry the ✓ back', () => {
  let a = { ...newActor(2, 'sphere' as const), queue: forSlot(briefErrands(), 2) }
  a = advance(a, 0)
  expect(a.trip?.to).toEqual({ kind: 'hq' })
  const arrive = a.trip!.dur
  a = advance(a, arrive + 10)
  expect(a.at).toEqual({ kind: 'hq' })
  expect(a.stay?.tag).toBe('brief')
  expect(walkerOf(a, arrive + 10)).toMatchObject({ facing: 'left', carry: 'paper' })
  a = advance(a, arrive + 1700)
  expect(a.trip).toMatchObject({ to: { kind: 'desk', slot: 2 }, carry: 'paper' })
  a = advance(a, arrive + 1700 + a.trip!.dur + 10)
  expect(a.at).toEqual({ kind: 'desk', slot: 2 })
  expect(walkerOf(a, arrive + 9000)).toBe(null)
  a = advance({ ...a, queue: forSlot(replyErrands(), 2) }, 20_000)
  expect(a.trip).toMatchObject({ to: { kind: 'hq' }, carry: 'done' })
})

test('frames encode to small PNGs', () => {
  const f = drawScene(scene({ walkers: [{ look: 'sphere', x: 60, y: 30, facing: 'right', frame: 1 }] }), 5, 400)
  const png = encodePngRgb(504, 459, scaleInto(f, 3, 504, 459))
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.length).toBeLessThan(60_000)
})
