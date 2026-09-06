# Apex Drive

A first-person 3D racing game. You sit in the driver's seat — dials, wheel,
mirror and all — and race five rivals over a 3.5 km circuit with hills, a
hairpin and a very fast sweeper.

No build step, no package manager, no dependencies: open `index.html` in a
browser and drive. Everything is drawn with raw WebGL, and every texture in
the game is painted at load time with a 2D canvas, so there is not a single
asset file to fetch.

## Controls

| | | | |
| --- | --- | --- | --- |
| Steer | `←` `→` or `A` `D` | Handbrake | `Space` |
| Throttle | `↑` or `W` | Look behind | `B` |
| Brake, then reverse | `↓` or `S` | Back to the track | `R` |
| Pause | `P` or `Esc` | Sound on/off | `M` |

On a touchscreen the four pads at the bottom of the screen do the same job:
steering under the left thumb, gas and brake under the right. Hold the phone
in landscape — in portrait the game says so rather than trying.

On iOS, **Share → Add to Home Screen** gives it the whole screen with no
browser chrome. The layout keeps clear of the notch and the home indicator.

## The race

Pick one, three or five laps and how quick you want the rivals to be, then
watch the five red lights. You start at the back of the grid; the field runs
the racing line, brakes for what is coming and gives way rather than driving
through each other, so the way past is usually to carry more speed out of a
corner than they do.

Lap times, your best lap and your position come up on the heads-up display,
with a live map of the circuit in the corner. A lap only counts if you go
round the whole thing — cutting back onto the straight will not tick the
counter over.

## The car

Everything you see is from the driver's eyes, about 1.15 m up and a third of
a metre left of the centre line:

- **The rear-view mirror really is a mirror.** The scene is drawn a second
  time each frame from a rear-facing camera, with the projection flipped,
  straight into the rectangle the mirror frame leaves open in the cockpit.
- **The cockpit moves with the car** — it leans into the roll, bobs on the
  suspension and shakes when you hit something.
- **The wheel turns** with your steering, the tacho follows the revs through
  six gears, and the speedometer needle is reading the actual car speed.

## How the driving works

A light arcade model, but a physical one rather than a set of thresholds:

- **Only the front wheels steer, so the car turns about its rear axle.** The
  nose swings wide and the tail follows it round, and because you are sitting
  a metre and a half ahead of that axle, the view sweeps outward as the car
  takes the corner. Pivoting about the middle of the car instead — which is
  what a shopping trolley does — reads from the driver's seat as the whole
  car sliding sideways.
- **The car has momentum, and it does not turn with the body.** When the
  heading rotates, the velocity keeps pointing where it was already going;
  read back in the new heading, part of what was straight ahead is now
  sideways. That difference is the slip angle, and it is what the tyres have
  to work against.
- **Tyres bite harder the more they are asked, up to a limit.** Sideways grip
  builds with the slip angle and then saturates: under the limit the car
  leans on the tyres and takes a set, a couple of degrees out of line; past
  it they let go and the car slides. That is where drifting comes from, and
  why the handbrake — which takes away two thirds of the sideways grip
  without changing how fast the car rotates — steps the back out.
- **Steering is proportional, not on/off.** Full input asks for the smaller
  of two real limits: the steering lock, which is what you feel at walking
  pace, and grip over speed, which is what you feel at 200 km/h. Everything
  between centre and full maps across that range, so a tap at speed is a
  small correction rather than a dart. Full lock asks for a shade more than
  the tyres hold, so leaning on it washes the nose gently wide.
- Engine force falls away as you approach top speed; drag and rolling
  resistance take it back. Grass has under half the grip and twelve times the
  rolling resistance of tarmac, so running wide costs real time.
- Guardrails are solid: you lose the speed you carried into them.

## How it is drawn

| Piece | What it does |
| --- | --- |
| `js/glx.js` | 4×4 matrix maths, shader/program setup, and a mesh builder |
| `js/textures.js` | Every texture, painted procedurally: tarmac, grass, trees, the sky panorama, the chequered flag |
| `js/track.js` | The circuit: a closed Catmull-Rom spline resampled at an even 4 m, plus "where am I on the track" and "how high is the ground here" |
| `js/meshes.js` | Geometry: tarmac, kerbs, ground, guardrails, gantry, grandstands, and the car |
| `js/audio.js` | Engine, wind and impacts, synthesised with Web Audio |
| `js/game.js` | Renderer, driving model, rivals, race rules and the HUD |

Two details worth knowing:

**The ground is in two pieces.** A narrow ribbon follows the road so the
verges match the tarmac exactly, and a coarse grid covers the rest of the
world. The ribbon has to stay narrower than the tightest corner on the
circuit — a ribbon wider than the radius it is going around folds over
itself — so it stops 26 m out and a skirt hides the seam with the grid
underneath.

**The cockpit is built from separate pieces** rather than one big drawing.
Only the parts that actually move (the dials and the wheel) are ever
repainted; the dash, pillars and roof are finished layers the browser can
shift around. Doing it the obvious way — one full-screen SVG, transformed
every frame — cost more time per frame than drawing the entire 3D world.

## Requirements

A browser with WebGL 1. Sound needs Web Audio and starts on the first press
of **Start race**, because browsers will not let a page make noise before
you ask it to.
