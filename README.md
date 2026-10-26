# Threadbare Regex

A from-scratch regex engine — hand-written parser → Thompson NFA construction → Pike VM simulation — that draws the NFA on canvas and animates the live state set as each input character is consumed.

## The pipeline

1. **Parser** (`parser.ts` → `ast.ts`) — hand-written recursive descent producing an AST
2. **Thompson construction** (`nfa.ts`) — builds an epsilon-NFA from the AST
3. **Pike VM** (`vm.ts`) — simulates the NFA with explicit thread lists; each thread carries its start position so earlier matches keep priority, and the visualizer receives a frame per input character: the active state set, the transitions that fired, the current candidate span, and committed matches
4. **Canvas layout** (`layout.ts`) — positions states and edges and draws the graph

## Features

- Step-by-step animation of the NFA consuming input
- Match tracking with spans (growing candidate plus committed matches)
- Pure, DOM-free TypeScript engine covered by Vitest (`tests/`)

## Run

```bash
npm install
npm run dev
npm test
npm run build
```

## Layout

```
src/engine/   ast, parser, nfa, vm, layout
src/main.ts   UI wiring
```

## License

MIT
