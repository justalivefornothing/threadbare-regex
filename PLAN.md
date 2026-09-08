# Threadbare — plan

A from-scratch regex engine (parser -> Thompson NFA -> Pike-VM simulation) that
draws the automaton on canvas and animates the live state set as it consumes each
input character.

## Goal

Type `a(b|c)*d` and watch the NFA appear. Type an input string and watch the set
of active states light up and travel through the graph one character at a time,
with the match span underlined below the input. No backtracking anywhere: the
engine is linear in `pattern × input`, and a demo button proves it against the
native `RegExp` on a pathological pattern.

## Features (all required)

- Parser: literals, `.`, classes `[a-z0-9^]` (with negation and ranges), escapes
  `\d \w \s` (and their uppercase complements), groups, alternation `|`,
  quantifiers `* + ? {m,n}`, anchors `^ $`.
- Thompson construction with epsilon edges; live state count.
- Pike-style state-set simulation with epsilon closure (generation-stamped
  visited array). Linear time on `(a*)*b` vs `aaaa…c`.
- Canvas rendering with automatic layered layout (BFS ranks), curved dashed
  epsilon edges, labelled transitions.
- Step controls: play / pause / step / reset + scrubber over the input; active
  states pulse.
- Match finder: leftmost-longest matches across the input, highlighted span,
  all matches listed with indices.
- Catastrophic-backtracking demo button: engine time vs native `RegExp`.
- Shareable URL hash (`#p=<pattern>&i=<input>`).

## Architecture

```
src/
  engine/
    ast.ts        AST node types
    parser.ts     recursive-descent parser  (string -> AST)
    nfa.ts        Thompson construction     (AST -> NFA {states, start, accept})
    vm.ts         Pike VM: epsilon closure, step, test/exec/findAll
    layout.ts     BFS rank layout           (NFA -> positions)
    index.ts      compile(pattern) -> { nfa, test, exec, findAll, stepper }
  ui/
    render.ts     canvas drawing of graph + active set + eased re-layout
    controls.ts   toolbar wiring, playback loop, scrubber, hash sync
    demo.ts       catastrophic-backtracking benchmark
  main.ts
  style.css
tests/
  engine.test.ts  spec assertions + extra edge cases
```

The engine is DOM-free and fully unit-tested with vitest. The UI depends on the
engine, never the other way round.

## Milestones

1. Plan, license, git init.
2. Scaffold vite vanilla-ts + vitest.
3. Engine: parser, Thompson NFA, Pike VM, tests green.
4. Canvas renderer + layered layout + eased re-layout.
5. Toolbar: pattern/input fields, playback, scrubber, match list, state count.
6. Backtracking demo + URL hash sharing.
7. Build, smoke test, screenshot, README, publish (private).

## UI direction

Dark blueprint: deep navy `#0b1424` canvas with faint grid, cyan node outlines,
dashed slate epsilon curves, active states filled electric lime. All chrome in a
single bottom toolbar set in a condensed sans (Barlow Condensed via @fontsource).
Graph eases to its new layout over 200 ms when the pattern changes.
