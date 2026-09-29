# fly.io

An endless flying game in the spirit of Race the Sun, built with Three.js.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check + static build into dist/
```

Controls: arrow keys or A / D to steer, or hold either half of the screen on a phone. In the menu, ← → picks a plane and ↑ ↓ (or W / S) picks a world. Space or Enter to start, C to change the camera view, P or Esc to pause (Q quits to the menu from there), M to mute. The game pauses by itself if you switch tabs.

Camera views: far, chase, near and cockpit. The cockpit view puts you on the plane and rolls with it.

## Worlds

- **Dusk:** sunset sands, long shadows and black monoliths.
- **Meadow:** a voxel village on bright green hills under a blue sky. Trees, cottages, hedges, fences and haystacks are the obstacles; fluffy clouds drift overhead and among the hills, casting shadows on the grass, while sheep graze and flowers dot the meadow.

Every world is built from the same two instanced shapes, boxes and pyramids, coloured per piece, so a world is just a palette, a terrain profile and a pair of layout functions (see `src/game/worlds.ts` and `src/game/scenery.ts`).

## Meta Quest (VR)

WebXR only runs on secure pages, so plain `http://` addresses will not offer VR.

- **Deployed:** open the Vercel URL in the Quest browser and press PLAY IN VR.
- **Local:** run `pnpm dev:vr`, then open `https://<your-computer-ip>:5173` in the Quest browser. Accept the certificate warning (Advanced, then Proceed) and press PLAY IN VR.

VR controls: thumbstick steers, and in the menu flicks left / right for a plane and up / down for a world. Trigger or A / X starts, A / X pauses, B / Y changes the camera view, grip quits to the plane menu from the pause or game over screen. Pressing the Quest home button also pauses.

For comfort in VR the horizon never rolls and the camera never shakes, and a soft vignette closes in at the edges of sight while you slide sideways in the views behind the plane. Crashes buzz the controllers instead.

## Milestones

1. [x] Ship flies over a scrolling ground with camera follow and banked steering
2. [x] Procedural chunks with hills and obstacle variety stream in ahead, plus a sunset sky
3. [x] Collision, 10 lives, crash feedback, game over and restart
4. [x] Main menu with selectable planes and wingtip trails, remembered between visits
5. [x] Score with a no-crash multiplier, saved best score
6. [x] Synthesised audio: wind and engine, arpeggio music with drums during runs, crash and menu sounds, mute with M
7. [x] Meta Quest VR with far, chase, near and cockpit views
8. [x] World two, the meadow, with six new planes and a world picker
9. [ ] Deploy
