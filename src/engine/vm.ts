import { accepts, consumes, type Nfa } from './nfa'

export interface Span {
  start: number
  end: number
}

/** One snapshot of the simulation, used by the visualiser. */
export interface Frame {
  /** Characters consumed so far (cursor position in the input). */
  pos: number
  /** Every state reached at this position, including epsilon states walked through. */
  active: number[]
  /** Consuming states that fired to produce this frame (their out-edges light up). */
  fired: number[]
  /** Whether the start state was (re)seeded at this position. */
  seeded: boolean
  /** Best match so far in the current scan; may still grow. */
  candidate: Span | null
  /** Matches already committed. */
  matches: Span[]
}

/**
 * Pike-style simulation. A thread is a (state, start) pair; threads live in
 * insertion order, which is also priority order (earliest start first), so
 * when two threads reach the same state the earlier one keeps it.
 */
class ThreadList {
  states: number[] = []
  starts: number[] = []
  clear(): void {
    this.states.length = 0
    this.starts.length = 0
  }
}

export class Vm {
  readonly nfa: Nfa
  private readonly visited: Uint32Array
  private gen = 0

  constructor(nfa: Nfa) {
    this.nfa = nfa
    this.visited = new Uint32Array(nfa.states.length)
  }

  /**
   * Follow epsilon edges from `s`, adding every consuming/accepting state
   * reached to `list` with thread-start `start`. Anchors are checked against
   * `pos`. The generation stamp makes revisits O(1) with no per-step clearing.
   */
  private closure(list: ThreadList, s: number, start: number, pos: number, len: number, all: number[] | null): void {
    const { states } = this.nfa
    const stack = [s]
    while (stack.length) {
      const i = stack.pop()!
      if (this.visited[i] === this.gen) continue
      this.visited[i] = this.gen
      all?.push(i)
      const st = states[i]
      switch (st.kind) {
        case 'split':
          // push out1 first so `out` (the preferred branch) is explored first
          stack.push(st.out1, st.out)
          break
        case 'eps':
          stack.push(st.out)
          break
        case 'assert':
          if (st.at === 'start' ? pos === 0 : pos === len) stack.push(st.out)
          break
        default:
          list.states.push(i)
          list.starts.push(start)
      }
    }
  }

  /**
   * Leftmost-longest search beginning at `from`, in a single forward pass:
   * the start state is seeded at every position until some thread accepts;
   * after that only threads that started at (or before) the best start
   * survive, and the match end is pushed forward each time one of them
   * accepts again. Linear in |input| × |states|.
   */
  scan(input: string, from: number, frames: Frame[] | null, committed: Span[] = []): Span | null {
    const { nfa } = this
    const len = input.length
    let cur = new ThreadList()
    let next = new ThreadList()
    let bestStart = -1
    let bestEnd = -1
    let pos = from

    let all: number[] | null = frames ? [] : null
    this.gen++
    this.closure(cur, nfa.start, pos, pos, len, all)
    let fired: number[] = []
    let seeded = true

    while (true) {
      // Record accepting threads and count the ones still worth running.
      // Threads are sorted by start, so once one accepts every later thread
      // in the list started at or after it and can be dropped.
      let live = 0
      for (let t = 0; t < cur.states.length; t++) {
        const start = cur.starts[t]
        if (bestStart !== -1 && start > bestStart) continue
        if (cur.states[t] === nfa.accept) {
          if (bestStart === -1 || start <= bestStart) {
            bestStart = start
            bestEnd = pos
          }
        } else {
          live++
        }
      }

      if (frames) {
        frames.push({
          pos,
          active: all!,
          fired,
          seeded,
          candidate: bestStart === -1 ? null : { start: bestStart, end: bestEnd },
          matches: committed.slice(),
        })
      }

      if (pos === len) break
      if (live === 0 && bestStart !== -1) break

      // step on input[pos]
      const c = input.charCodeAt(pos)
      this.gen++
      next.clear()
      all = frames ? [] : null
      fired = []
      for (let t = 0; t < cur.states.length; t++) {
        const start = cur.starts[t]
        if (bestStart !== -1 && start > bestStart) continue
        const st = nfa.states[cur.states[t]]
        if (consumes(st) && accepts(st, c)) {
          if (frames) fired.push(cur.states[t])
          this.closure(next, (st as { out: number }).out, start, pos + 1, len, all)
        }
      }
      pos++
      seeded = bestStart === -1
      if (seeded) this.closure(next, nfa.start, pos, pos, len, all)
      ;[cur, next] = [next, cur]
    }

    return bestStart === -1 ? null : { start: bestStart, end: bestEnd }
  }

  exec(input: string, from = 0): Span | null {
    return from > input.length ? null : this.scan(input, from, null)
  }

  test(input: string): boolean {
    return this.exec(input) !== null
  }

  /** All non-overlapping leftmost-longest matches; empty matches advance by one. */
  findAll(input: string): Span[] {
    const out: Span[] = []
    let pos = 0
    while (pos <= input.length) {
      const m = this.scan(input, pos, null)
      if (!m) break
      out.push(m)
      pos = m.end > m.start ? m.end : m.end + 1
    }
    return out
  }

  /** The full findAll process as a sequence of frames for the visualiser. */
  trace(input: string, maxFrames = 4000): Frame[] {
    const frames: Frame[] = []
    const committed: Span[] = []
    let pos = 0
    while (pos <= input.length && frames.length < maxFrames) {
      const m = this.scan(input, pos, frames, committed)
      if (!m) break
      committed.push(m)
      pos = m.end > m.start ? m.end : m.end + 1
    }
    // the final frame should show every committed match
    if (frames.length) frames[frames.length - 1].matches = committed.slice()
    return frames
  }
}
