# War Tower

A top-down tower defence campaign built for the iPhone screen. Portrait, touch,
no build step and no dependencies — open `index.html` and play.

## The idea

You are given a budget and a battlefield. So is the enemy — the same budget,
to the credit. You spend yours on weapon systems and site them on a grid around
their road; they spend theirs on the column that comes down it. Hold the line
for eight waves, then the terrain changes and you do it again — on ground that
fights you differently, against an enemy that has been reading your last eight
waves and shooting back at your emplacements.

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

## They shoot back

Emplacements have structure, and most enemy units carry a weapon they fire on
the move at whatever they can reach. Reach is short — a Trooper Mech engages
1.5 tiles, a Bulwark 2.1, a Siege Titan 3.8 — so the siting rules above stop
being a constraint and start being a decision:

- A **Cryo Coil** must sit within one tile of the road, so it is always inside
  small-arms reach. It is the emplacement you will lose.
- A **Mortar Pit** must sit two or more tiles off the road, which puts it out of
  reach of everything except a Titan.
- Everything else is your call: closer covers more road, further survives.

Damaged emplacements are patched up free between waves. Anything actually
destroyed is gone, and you pay full price to rebuild it.

## The enemy's war chest

Enemy command opens the campaign with **exactly your starting budget** and is
funded again before every wave. It never commits the whole chest at once — a
doctrine cap limits what any single wave can cost — and it banks the rest.

It is also paid for damage: **30 credits per point of core integrity** it takes
off you and **45 per emplacement destroyed**. A leaking line funds the force
that broke it, so a bad wave is felt twice.

The HUD shows what they have committed to the wave you are facing; the intel
strip shows what is still in reserve. Unit prices sit in the same range as your
own hardware — a Scout Bike is 32 credits, a Trooper Mech 48, a Bulwark Tank 92
— so you can read a wave's cost against what you could have built instead.

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

Six rounds of eight waves; the eighth wave of each round brings a Siege Titan,
which is high command's asset rather than a purchase and arrives whatever the
chest looks like. Between rounds your emplacements are recovered as 50%
salvage, so each new terrain starts from a clean board and a bigger wallet —
and the enemy carries its chest across too.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | HUD, battlefield canvas, dock and the four overlay screens. |
| `style.css` | Command-console shell, safe-area handling, both orientations. |
| `config.js` | Terrain, weapon, enemy and difficulty tables, plus the seeded RNG. |
| `game.js` | Map generation, combat both ways, the wave director and enemy economy, rendering and input. |

## How it is drawn

Everything is canvas 2D, drawn procedurally — there are no image assets. The
terrain is pre-rendered once per round to an offscreen canvas (a base wash,
soft organic blotches, fine grain, then decals, road and rock), so each frame
only pays for the moving parts: turrets, tracers, arcing shells, chain
lightning, splash rings and particles. Liquids are drawn as overlapping blobs
so adjacent tiles merge into one pool rather than a row of squares.

## One thing to know

There is no save. Closing the tab ends the campaign.
