import { inRanges, type Node, type Range } from './ast'

/**
 * NFA states. `out`/`out1` are state indices; -1 means "dangling" and only
 * appears mid-construction (every hole is patched before `build` returns).
 */
export type State =
  | { kind: 'char'; ch: number; out: number }
  | { kind: 'any'; out: number }
  | { kind: 'class'; ranges: Range[]; negated: boolean; label: string; out: number }
  | { kind: 'assert'; at: 'start' | 'end'; out: number }
  | { kind: 'eps'; out: number }
  | { kind: 'split'; out: number; out1: number }
  | { kind: 'match' }

export interface Nfa {
  states: State[]
  start: number
  /** Index of the single accepting state. */
  accept: number
}

/** True if the state consumes a character (as opposed to an epsilon-ish state). */
export function consumes(s: State): boolean {
  return s.kind === 'char' || s.kind === 'any' || s.kind === 'class'
}

/** Does a consuming state accept code unit `c`? */
export function accepts(s: State, c: number): boolean {
  switch (s.kind) {
    case 'char':
      return s.ch === c
    case 'any':
      return c !== 10 && c !== 13
    case 'class':
      return inRanges(s.ranges, c) !== s.negated
    default:
      return false
  }
}

/** Outgoing edges of a state as (target, isEpsilon) pairs. */
export function edges(s: State): { to: number; eps: boolean }[] {
  switch (s.kind) {
    case 'match':
      return []
    case 'split':
      return [
        { to: s.out, eps: true },
        { to: s.out1, eps: true },
      ]
    case 'eps':
    case 'assert':
      return [{ to: s.out, eps: true }]
    default:
      return [{ to: s.out, eps: false }]
  }
}

/** A dangling out-pointer awaiting its target. */
interface Hole {
  s: number
  slot: 'out' | 'out1'
}

/** A partially built automaton: an entry state plus its dangling exits. */
interface Frag {
  start: number
  outs: Hole[]
}

/**
 * Thompson construction. Each AST node becomes a fragment with exactly one
 * entry and a list of dangling exits; concatenation patches exits into the
 * next fragment's entry, alternation and repetition add a `split` state.
 */
export function build(ast: Node): Nfa {
  const states: State[] = []

  const add = (s: State): number => {
    states.push(s)
    return states.length - 1
  }

  const patch = (outs: Hole[], target: number): void => {
    for (const h of outs) {
      const st = states[h.s]
      if (h.slot === 'out' && 'out' in st) st.out = target
      else if (h.slot === 'out1' && st.kind === 'split') st.out1 = target
    }
  }

  const concat = (a: Frag, b: Frag): Frag => {
    patch(a.outs, b.start)
    return { start: a.start, outs: b.outs }
  }

  const alt = (a: Frag, b: Frag): Frag => {
    const s = add({ kind: 'split', out: a.start, out1: b.start })
    return { start: s, outs: [...a.outs, ...b.outs] }
  }

  const star = (a: Frag): Frag => {
    const s = add({ kind: 'split', out: a.start, out1: -1 })
    patch(a.outs, s)
    return { start: s, outs: [{ s, slot: 'out1' }] }
  }

  const plus = (a: Frag): Frag => {
    const s = add({ kind: 'split', out: a.start, out1: -1 })
    patch(a.outs, s)
    return { start: a.start, outs: [{ s, slot: 'out1' }] }
  }

  const opt = (a: Frag): Frag => {
    const s = add({ kind: 'split', out: a.start, out1: -1 })
    return { start: s, outs: [...a.outs, { s, slot: 'out1' }] }
  }

  const empty = (): Frag => {
    const s = add({ kind: 'eps', out: -1 })
    return { start: s, outs: [{ s, slot: 'out' }] }
  }

  const frag = (n: Node): Frag => {
    switch (n.type) {
      case 'Char': {
        const s = add({ kind: 'char', ch: n.ch, out: -1 })
        return { start: s, outs: [{ s, slot: 'out' }] }
      }
      case 'Any': {
        const s = add({ kind: 'any', out: -1 })
        return { start: s, outs: [{ s, slot: 'out' }] }
      }
      case 'Class': {
        const s = add({ kind: 'class', ranges: n.ranges, negated: n.negated, label: n.label, out: -1 })
        return { start: s, outs: [{ s, slot: 'out' }] }
      }
      case 'Anchor': {
        const s = add({ kind: 'assert', at: n.at, out: -1 })
        return { start: s, outs: [{ s, slot: 'out' }] }
      }
      case 'Empty':
        return empty()
      case 'Group':
        return frag(n.body)
      case 'Concat':
        return n.items.map(frag).reduce(concat)
      case 'Alt':
        return n.alts.map(frag).reduce(alt)
      case 'Star':
        return star(frag(n.body))
      case 'Plus':
        return plus(frag(n.body))
      case 'Opt':
        return opt(frag(n.body))
      case 'Repeat': {
        // body{m,n}  =>  body × m  ·  (body?) × (n − m)      (or body* when unbounded)
        const parts: Frag[] = []
        for (let k = 0; k < n.min; k++) parts.push(frag(n.body))
        if (n.max === null) parts.push(star(frag(n.body)))
        else for (let k = n.min; k < n.max; k++) parts.push(opt(frag(n.body)))
        return parts.length === 0 ? empty() : parts.reduce(concat)
      }
    }
  }

  const f = frag(ast)
  const accept = add({ kind: 'match' })
  patch(f.outs, accept)
  return { states, start: f.start, accept }
}
