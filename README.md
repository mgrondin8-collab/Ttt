# Tic Tac Toe

A small, dependency-free tic tac toe game that runs straight from the file
system — no build step, no package manager, no server required.

## Play

Open `index.html` in a browser.

## Features

- **Two modes** — play a friend on the same device, or play the computer.
- **Three levels**
  - *Easy* — the computer moves at random.
  - *Fair* — mostly optimal, but it slips about a third of the time.
  - *Unbeatable* — full minimax search; the best you can do is draw.
- **Running scoreboard** for wins and draws, with a reset button.
- **Keyboard play** — arrow keys move around the grid (wrapping at the edges),
  Enter or Space places a mark.
- **Accessible** — the board is a labelled grid, each square announces its
  position and contents, and the status line is a live region.
- **Responsive**, and follows the system light/dark preference.

## Design

The board is the classic `#` figure rather than nine boxes, and every mark is
an SVG stroke that animates on as though drawn with a pen — including the line
that scores through the winning three. Type is Bodoni Moda for the masthead,
Fira Sans for the interface and Fira Mono for the figures, over a ruled
graph-paper ground. Both themes are defined at the token level in `style.css`,
so the page holds up whether the viewer is on light, dark, or system default.

Animation is skipped entirely under `prefers-reduced-motion`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the board, controls and scoreboard. |
| `style.css` | Palette tokens, layout, and both themes. |
| `script.js` | Game rules, minimax computer player, drawn marks, keyboard handling. |
| `agent.html` | The Life Agent chat page. |
| `agent.css` | Chat layout and both themes. |
| `agent.js` | Conversation, streaming replies from Claude, settings. |

## How the unbeatable player works

`minimax` in `script.js` scores a finished position as `10 - depth` when the
computer wins and `depth - 10` when it loses. Weighting by depth makes the
computer take the *fastest* win available and the *slowest* loss, so it never
stalls on an already-won position and always forces the longest defence.

Verified exhaustively: over the 569 distinct games where the human opens and
plays every legal sequence, the unbeatable level wins 386 and draws 183 — it
never loses.

## One thing to know

Scores live in memory only, so a page reload clears them.

# Life Agent

`agent.html` is a chat page for talking with your life agent, a warm,
conversational companion powered by Claude (`claude-opus-5-5`). It replies the
way a person would in a normal discussion: short, plain prose, one question at a
time, and in the same language you write in.

## Use it

1. Open `agent.html` in a browser.
2. In **Settings**, paste an Anthropic API key (create one at
   console.anthropic.com) and, if you want, the name the agent should call you.
3. Type and press Enter. Shift+Enter adds a new line.

Replies stream in as they're written. The conversation is saved in this browser,
so it's still there after a reload. **New conversation** clears it.

## Good to know

- The API key is stored in this browser's local storage and sent only to
  Anthropic. Don't host this page on a public site with your key in it; anyone
  using that browser can use the key.
- If the model declines a message, the request asks Anthropic to retry it on a
  recommended fallback model automatically (`fallbacks: "default"`).
- Changing your name in Settings applies to the next new conversation.
