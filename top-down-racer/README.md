# Top-Down Racer

A top-down circuit racer that runs straight from the file system — no build
step, no package manager, no server. Open `index.html` in a browser.

## Racing

You start at the back of the grid. Everyone else is already quicker than you.

| Key | |
| --- | --- |
| <kbd>&uarr;</kbd> / <kbd>W</kbd> | throttle |
| <kbd>&darr;</kbd> / <kbd>S</kbd> | brake, then reverse once you have stopped |
| <kbd>&larr;</kbd> <kbd>&rarr;</kbd> | steer |
| <kbd>Space</kbd> | handbrake |
| <kbd>R</kbd> | restart |
| <kbd>Esc</kbd> | pause |

On a touch screen the on-screen pads appear instead.

Set the race up from the menu: 1 to 8 laps, up to seven rivals, and three
levels of opposition. Your best lap survives a reload.

## How the car drives

The car is not on rails. Each step it steers the *body* kinematically — a
bicycle model, `ω = v/L · tan δ` — and then resolves the velocity, which has
not moved, against the new heading. The angle between the two is the slip
angle, and grip is what closes it:

```
across = clamp(-lateral × lateralBite, -gripCap, +gripCap)
```

Below the cap the tyres pull the slide straight. Above it they cannot, and the
car keeps going the way it was already going. That single clamp is where the
whole feel of the thing comes from: lift mid-corner and it tucks in, pull the
handbrake and `gripCap` drops to a third and the back steps out, run onto the
grass and it drops to under half.

Everything is tuned in pixels and seconds, with one constant — `pxPerMetre`
in `src/physics.js` — converting to the figures on the speedometer and the
circuit length on the menu, so the two can never drift apart.

## How the circuit is built

`src/track.js` starts from 25 control points, runs a Catmull-Rom spline
through them and resamples the result at a uniform 6 px, so one station index
always means the same distance travelled. From that it derives the edges,
the curvature, and two things the rivals need:

- **A racing line.** Each station may only slide along its own normal, and is
  repeatedly pulled toward the midpoint of its neighbours — which minimises
  curvature, and produces out-in-out through the corners on its own. Plain
  Gauss-Seidel needs O(n²) passes to converge over 943 stations, so it runs at
  strides of 64, 32, 16 … 1: the coarse passes move the line, the fine ones
  clean it up.
- **A speed for every station**, `v = √(a_lat / k)` from that line's
  curvature, then swept backwards so each station is also slow enough to have
  braked for the one after it. A rival simply drives to that number.

## Checks

The circuit and the car are both easy to get subtly wrong, so both are
verified rather than eyeballed:

```
node tools/check-all.js
```

- **`check-track.js`** — the circuit may not overlap itself, no corner may be
  tighter than the track is wide (below that the inside edge folds through
  itself), the tarmac has to fit the world, the resampling has to be uniform,
  the grid has to sit on a straight, and there has to be at least one real
  braking zone.
- **`check-physics.js`** — top speed, time to reach it, braking distance,
  steady-state cornering radius at three speeds, that the handbrake actually
  breaks traction, that grass costs real time, and that no sequence of inputs
  drives the state non-finite.
- **`check-race.js`** — runs whole races at all three levels with the field
  driven by the AI: everyone has to finish, lap times have to be believable,
  the field must stay on the road and inside the barriers, positions must be a
  permutation of 1..N, and harder levels must actually be faster.

These caught the real bugs during the build — the first circuit had a corner
with a 27 px radius on a 210 px-wide track, and the car could not slide at
all because the velocity was being rotated along with the heading.

## Files

| File | |
| --- | --- |
| `index.html` | Markup for the canvas, the HUD and the overlays. |
| `style.css` | Palette tokens, HUD layout, panels, touch pads. |
| `src/util.js` | Maths and formatting helpers, seeded RNG. |
| `src/track.js` | Spline, resampling, edges, racing line, speed profile. |
| `src/physics.js` | The car: slip angles, grip, surfaces. |
| `src/ai.js` | Rival drivers — aim point, speed target, avoidance. |
| `src/race.js` | Grid, surfaces, contact, laps, order. No DOM. |
| `src/input.js` | Keyboard and touch, normalised to one control object. |
| `src/render.js` | Pre-rendered circuit, camera, cars, rubber, minimap. |
| `src/game.js` | The loop, the overlays, the read-outs. |
| `tools/` | The checks above. |

`race.js` deliberately knows nothing about the canvas, which is why a whole
race can be run headless in `check-race.js` — and why the AI can be handed the
player's car to test the game the way a person plays it.

## Two things to know

Everything is drawn with the Canvas 2D API; there is no WebGL and no asset
loading, so the whole game is the ten files above. The one external request is
a Google Fonts stylesheet, which is a nicety — block it, or open the page with
no network at all, and the fallback stack takes over.
