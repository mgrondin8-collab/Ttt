# War Tower

A top-down tower defence campaign built for the iPhone screen. Portrait, touch,
no build step and no dependencies — open `index.html` and play.

## The idea

You are given a budget and a battlefield. You spend the budget on weapon
systems, site them on a grid around the enemy road, and hold the line for eight
waves. Then the terrain changes and you do it again — on ground that fights you
differently, against an enemy that has been reading your last eight waves.

## Play

Open `war-tower/index.html` in Safari (or any browser). Add it to the home
screen for a full-screen, status-bar-aware app.

1. Pick a difficulty and deploy.
2. Tap a weapon in the dock, then tap the grid to emplace it. Valid tiles are
   bracketed in cyan; the range ring previews before you commit.
3. Tap a placed weapon to upgrade it (three marks) or sell it back at 60%.
4. Start the wave. Speed runs at 1×, 2× or 3×.

## The six battlefields

Each round generates a new map — a fresh road, fresh rock, water and cover —
and each terrain bends the rules:

| Sector | Effect |
| --- | --- |
| Verdant Basin | None. Open ground. |
| Ashfall Dunes | Heat haze: range −10%, enemies +5% speed. |
| Glacier Shelf | Deep cold: enemies −14% speed, reload 10% slower. |
| Cinder Rift | Thermals: enemies +12% speed, reload 10% faster. |
| Mirewood | Mud and mist: enemies −16% speed, range −8%. |
| Sector Seven | Clear lanes: range +8%, enemies +6% speed on paved road. |

## Six weapons, six siting rules

Capability decides where a system can physically go — that is the placement
puzzle, not just "anywhere off the road".

| System | Cost | Sites | Notes |
| --- | --- | --- | --- |
| Gatling Nest | 90 | anywhere clear | Kinetic, ground + air, relentless, weak against plate. |
| Siege Cannon | 150 | anywhere clear | Explosive splash, ground only. |
| Cryo Coil | 120 | within 1 tile of the road | Pulses an area slow — short emitters. |
| Tesla Pylon | 200 | beside a rock outcrop | Needs grounding. Chains to 3 targets. |
| Mortar Pit | 230 | 2+ tiles off the road | Huge reach and blast, blind inside 2.2 tiles. |
| SAM Battery | 170 | anywhere clear | Homing missiles, air only. |

Armour subtracts from kinetic damage but never fully negates it; each enemy
type resists a different damage school.

## The enemy adapts

After every wave the director totals the damage you dealt by school — kinetic,
explosive, energy, cryo — decays the history, and rebuilds the next wave to
punish whatever you leaned on:

| You leaned on | They send | Because |
| --- | --- | --- |
| Kinetic | Bulwark Tank | 45% kinetic resistance and heavy plate. |
| Explosive | Scout Bike | Fast, small blast signature. |
| Energy | Aegis Walker | 65% energy resistance. |
| Cryo | Warhound | Thermally lined — slow-immune. |
| No anti-air | Wasp Drone | Flies straight over your ground guns. |

The INTEL line in the dock tells you what they concluded, before the wave
lands. How hard they read you is the difficulty:

| Level | Adaptation | Also |
| --- | --- | --- |
| Recruit | 0.18 | 780 credits, 25 integrity, weak waves. |
| Veteran | 0.45 | The intended fight. |
| Elite | 0.75 | +20% enemy health, tighter budget. |
| Nightmare | 1.00 | Every weakness exploited within a single wave. |

Six rounds of eight waves; the eighth wave of each round brings a Siege Titan.
Between rounds your emplacements are recovered as 50% salvage, so each new
terrain starts from a clean board and a bigger wallet.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | HUD, battlefield canvas, dock and the four overlay screens. |
| `style.css` | Command-console shell, safe-area handling, both orientations. |
| `config.js` | Terrain, weapon, enemy and difficulty tables, plus the seeded RNG. |
| `game.js` | Map generation, combat, the wave director, rendering and input. |

## How it is drawn

Everything is canvas 2D, drawn procedurally — there are no image assets. The
terrain is pre-rendered once per round to an offscreen canvas (a base wash,
soft organic blotches, fine grain, then decals, road and rock), so each frame
only pays for the moving parts: turrets, tracers, arcing shells, chain
lightning, splash rings and particles. Liquids are drawn as overlapping blobs
so adjacent tiles merge into one pool rather than a row of squares.

## One thing to know

There is no save. Closing the tab ends the campaign.
