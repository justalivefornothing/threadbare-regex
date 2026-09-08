import type { Node } from './ast'
import { build, type Nfa } from './nfa'
import { parse } from './parser'
import { Vm, type Frame, type Span } from './vm'

export { ParseError } from './parser'
export { layout } from './layout'
export { edges, consumes } from './nfa'
export type { Node } from './ast'
export type { Nfa, State } from './nfa'
export type { Frame, Span } from './vm'
export type { Layout, Point } from './layout'

export interface Compiled {
  pattern: string
  ast: Node
  nfa: Nfa
  test(input: string): boolean
  exec(input: string, from?: number): Span | null
  findAll(input: string): Span[]
  trace(input: string): Frame[]
}

/** pattern → AST → Thompson NFA → Pike VM, bundled behind a RegExp-ish API. */
export function compile(pattern: string): Compiled {
  const ast = parse(pattern)
  const nfa = build(ast)
  const vm = new Vm(nfa)
  return {
    pattern,
    ast,
    nfa,
    test: (input) => vm.test(input),
    exec: (input, from) => vm.exec(input, from),
    findAll: (input) => vm.findAll(input),
    trace: (input) => vm.trace(input),
  }
}
