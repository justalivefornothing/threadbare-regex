import { edges, type Nfa } from './nfa'

export interface Point {
  x: number
  y: number
}

export interface Layout {
  /** Position per state in abstract units: x = rank (0..ranks-1), y centred on 0. */
  points: Point[]
  ranks: number
  /** Tallest rank, in states. */
  height: number
}

/**
 * Layered layout: BFS from the start state assigns each state a rank (its
 * shortest epsilon-or-character distance from start), then states within a
 * rank are ordered by the mean position of their predecessors to reduce
 * crossings, and spread vertically around the centre line.
 */
export function layout(nfa: Nfa): Layout {
  const n = nfa.states.length
  const rank = new Int32Array(n).fill(-1)
  const preds: number[][] = Array.from({ length: n }, () => [])
  const queue = [nfa.start]
  rank[nfa.start] = 0

  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    for (const { to } of edges(nfa.states[i])) {
      preds[to].push(i)
      if (rank[to] === -1) {
        rank[to] = rank[i] + 1
        queue.push(to)
      }
    }
  }

  // Anything unreachable (can't happen with Thompson, but be safe) goes last;
  // the accept state is pinned to the final rank so the graph reads left→right.
  let ranks = 0
  for (let i = 0; i < n; i++) ranks = Math.max(ranks, rank[i] + 1)
  for (let i = 0; i < n; i++) if (rank[i] === -1) rank[i] = ranks - 1
  if (rank[nfa.accept] !== ranks - 1) {
    let has = false
    for (let i = 0; i < n; i++) if (i !== nfa.accept && rank[i] === rank[nfa.accept]) has = true
    rank[nfa.accept] = has ? ranks++ : ranks - 1
  }

  const byRank: number[][] = Array.from({ length: ranks }, () => [])
  for (let i = 0; i < n; i++) byRank[rank[i]].push(i)

  const points: Point[] = new Array(n)
  let height = 0
  for (let r = 0; r < ranks; r++) {
    const members = byRank[r]
    if (r > 0) {
      const key = new Map<number, number>()
      for (const s of members) {
        const ps = preds[s].filter((p) => rank[p] < r)
        key.set(s, ps.length ? ps.reduce((a, p) => a + points[p].y, 0) / ps.length : 0)
      }
      members.sort((a, b) => key.get(a)! - key.get(b)! || a - b)
    }
    height = Math.max(height, members.length)
    members.forEach((s, k) => {
      points[s] = { x: r, y: k - (members.length - 1) / 2 }
    })
  }

  return { points, ranks, height }
}
