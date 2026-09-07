# Reroute

A phone game about moving money between countries while one man keeps changing
the rules. Dependency-free, no build step: open `reroute/index.html` in a
browser, or serve the folder over anything.

You run a manufacturer with one plant in China and $120M. Sixteen quarters —
one presidential term — to reach $1,000M. Every quarter you decide where to
make things and where to sell them; every quarter the Oval Desk announces
something that invalidates the plan.

## The loop

1. **Book the quarter.** Each production line makes four units. Put them on
   lanes — an origin you own to any market — and the margin per unit is shown
   before you commit.
2. **Ship.** The ledger settles: revenue, production, freight, duty, overheads.
3. **He speaks.** One headline changes the board: a blanket rate, a targeted
   hike, a ninety-day pause, a deal, a retaliation, an export control, a court
   ruling, a 4 a.m. post.
4. **Reroute.** Build somewhere else, buy an exclusion, pre-clear ahead of the
   next hike, or make yourself a friend of the administration.

## The economics

Everything is per unit, in $M.

| Quantity | How it works |
| --- | --- |
| Revenue | The destination's price. A market absorbs a fixed number of units at full price; anything past its appetite clears at 60%. |
| Duty | `(production cost + freight) × rate` — charged on landed value, so a hike eats the *margin*, not the price. This is the whole game. |
| Freight | Distance between the two countries, times whatever is happening to shipping. |
| Overheads | $14M a quarter plus $9M per production line, paid whether you ship or not. |
| Net worth | Cash plus 70% of what your plants cost. |

The tension is that cheap production and low duty rarely sit in the same
country. China makes things for 20 and the US market pays 42, but the rate on
that lane is whatever he said this morning. A US plant makes things for 34 and
pays nothing at the border — and gets retaliated against the moment it exports.
Mexico is the nearshore middle, until it isn't.

### Four levers

- **Build** — a new line is capacity *and* a new origin. Relocating is the
  strategic answer to a tariff; it takes cash you would rather be compounding.
- **Carve-out** — buy an exclusion on one lane for four quarters. Cheaper the
  more favour you have.
- **Pre-clear** — pay today's duty on units that land later. When the next hike
  arrives, they come in at the old rate. Front-running a tariff is a real trade
  and it is priced as one.
- **Donate** — favour makes hikes land on somebody else's supply chain and
  carve-outs land on yours. It decays four points a quarter, so it has to be
  fed.

## Balance

`tools/simulate.js` plays the engine headlessly with fixed strategies. The
engine has no DOM in it precisely so this can run, which is how the numbers
below were set rather than guessed:

```
$ node reroute/tools/simulate.js 600
passive    median   487.8  p10   328.8  p90   611.4  bust   1%  hit target   0%
stubborn   median    92.7  p10      49  p90   271.1  bust  70%  hit target   0%
builder    median  1145.2  p10   624.6  p90  1413.1  bust   4%  hit target  70%
lobbyist   median   901.8  p10   247.1  p90  1200.7  bust   2%  hit target  35%
```

Read it as the shape of the game: *stubborn* — one plant, everything into the
US, never reroute — goes bankrupt seven times in ten. *Passive* ships sensibly
but never invests, and survives without ever getting near the target.
*Builder* relocates and clears the target 70% of the time. *Lobbyist* buys
influence instead of plants and lands in between, with much fatter tails: the
favour path is real, and it is a worse investment than moving your factory,
which is the joke.

## The President

He is a caricature of the 2025 tariff era, not a transcript, and he is never
named or quoted. What the game models is the *pattern* — rates announced off a
chart, a pause a week later when the bond market objects, deals whose annex
nobody has read, exclusions for whoever asked nicely, a crackdown on the
country everybody moved to last year, and a court quietly voiding the lot. The
mechanic being satirised is that the cost of the policy is not the rate. It is
that you cannot plan.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup: header, headline card, map, lane list, action dock, sheets. |
| `style.css` | Tokens and both themes, phone-first, safe-area aware. |
| `engine.js` | Countries, tariffs, lanes, settlement, and the event deck. No DOM. |
| `ui.js` | Rendering, steppers, sheets, the ledger, the ending. |
| `tools/simulate.js` | Headless balance harness. |
| `tools/bundle.js` | Inlines the four files above into `reroute.html`. |
| `reroute.html` | Built single-file version — one document you can host, mail, or publish anywhere. Rebuild it with `node reroute/tools/bundle.js`; don't edit it by hand. |

## Notes

- Both themes follow `prefers-color-scheme`; flow animation is skipped under
  `prefers-reduced-motion`.
- Your best net worth is kept in `localStorage`; nothing else is stored, and
  nothing leaves the device.
- Tapping a country on the map filters the lane list to routes touching it.
