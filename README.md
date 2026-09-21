# fly.io

An endless flying game in the spirit of Race the Sun, built with Three.js.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check + static build into dist/
```

Controls: arrow keys or A / D to steer, or hold either half of the screen on a phone. Space or Enter to start, Esc for the menu, M to mute.

## Milestones

1. [x] Ship flies over a scrolling ground with camera follow and banked steering
2. [x] Procedural chunks with hills and obstacle variety stream in ahead, plus a sunset sky
3. [x] Collision, 10 lives, crash feedback, game over and restart
4. [x] Main menu with fourteen selectable planes and wingtip trails, remembered between visits
5. [x] Score with a no-crash multiplier, saved best score
6. [x] Synthesised audio: wind and engine, arpeggio music with drums during runs, crash and menu sounds, mute with M
7. [ ] Deploy
