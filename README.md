# Tic Tac Toe

A small, dependency-free tic tac toe game that runs straight from the file
system — no build step, no package manager, no server required.

## Play

Open `index.html` in a browser.

## Features

- **Two modes** — play a friend on the same device, or play the computer.
- **Three difficulty levels**
  - *Easy* — the computer moves at random.
  - *Medium* — mostly optimal, but it slips about a third of the time.
  - *Unbeatable* — full minimax search; the best you can do is draw.
- **Running scoreboard** for wins and draws, with a reset button.
- **Keyboard play** — arrow keys move around the grid (wrapping at the edges),
  Enter or Space places a mark.
- **Accessible** — the board is a labelled grid, each square announces its
  position and contents, and the status line is a live region.
- **Responsive** and follows the system light/dark preference.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the board, controls and scoreboard. |
| `style.css` | Theming, layout and the board grid. |
| `script.js` | Game rules, minimax computer player, keyboard handling. |

## How the unbeatable player works

`minimax` in `script.js` scores a finished position as `10 - depth` when the
computer wins and `depth - 10` when it loses. Weighting by depth makes the
computer take the *fastest* win available and the *slowest* loss, so it never
stalls on an already-won position and always forces the longest defence.
