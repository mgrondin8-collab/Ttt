/* Tic Tac Toe — game logic, drawn marks, and a minimax computer player. */

const HUMAN = 'X';
const CPU = 'O';
const SVG_NS = 'http://www.w3.org/2000/svg';

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

const state = {
  board: Array(9).fill(''),
  turn: HUMAN,
  mode: 'cpu',          // 'cpu' | 'human'
  difficulty: 'medium', // 'easy' | 'medium' | 'hard'
  over: false,
  locked: false,        // true while the computer is "thinking"
  scores: { X: 0, O: 0, draw: 0 },
};

const boardEl = document.getElementById('board');
const strikeEl = document.getElementById('strike');
const statusEl = document.getElementById('status');
const difficultyControl = document.getElementById('difficulty-control');
const scoreEls = {
  X: document.getElementById('score-x'),
  O: document.getElementById('score-o'),
  draw: document.getElementById('score-draw'),
};
const nameEls = {
  X: document.getElementById('score-x-name'),
  O: document.getElementById('score-o-name'),
};

const reducedMotion = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ----------------------------------------------------------- game rules */

function winnerOf(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line };
    }
  }
  return null;
}

function emptyCells(board) {
  const open = [];
  for (let i = 0; i < 9; i++) if (!board[i]) open.push(i);
  return open;
}

function opponent(mark) {
  return mark === 'X' ? 'O' : 'X';
}

function playerName(mark) {
  if (state.mode === 'cpu') return mark === HUMAN ? 'You' : 'Computer';
  return mark;
}

/* -------------------------------------------------------- computer play */

/** Minimax with depth preference, so the computer wins fast and loses slow. */
function minimax(board, mark, depth) {
  const result = winnerOf(board);
  if (result) return { score: result.mark === CPU ? 10 - depth : depth - 10 };

  const open = emptyCells(board);
  if (open.length === 0) return { score: 0 };

  const maximizing = mark === CPU;
  let best = { score: maximizing ? -Infinity : Infinity, index: open[0] };

  for (const index of open) {
    board[index] = mark;
    const { score } = minimax(board, opponent(mark), depth + 1);
    board[index] = '';

    if (maximizing ? score > best.score : score < best.score) {
      best = { score, index };
    }
  }
  return best;
}

function randomMove(board) {
  const open = emptyCells(board);
  return open[Math.floor(Math.random() * open.length)];
}

function chooseMove(board) {
  if (state.difficulty === 'easy') return randomMove(board);
  // "Fair" plays well most of the time but is beatable.
  if (state.difficulty === 'medium' && Math.random() < 0.35) return randomMove(board);
  return minimax(board.slice(), CPU, 0).index;
}

function cpuTurn() {
  state.locked = true;
  render();
  setStatus('Computer is thinking');

  window.setTimeout(() => {
    state.locked = false;
    if (state.over) return;
    const index = chooseMove(state.board);
    if (index !== undefined) play(index);
  }, 380);
}

/* ------------------------------------------------- drawing on the board */

/** Animates a stroke so it appears to be drawn by hand. */
function drawStroke(shape, duration, delay) {
  if (reducedMotion || typeof shape.getTotalLength !== 'function') return;

  // getTotalLength throws on an element that is not part of the rendered tree.
  let length = 0;
  try {
    length = shape.getTotalLength();
  } catch (err) {
    return;
  }
  if (!length) return;

  shape.style.strokeDasharray = String(length);
  shape.style.strokeDashoffset = String(length);
  window.requestAnimationFrame(() => {
    shape.style.transition = `stroke-dashoffset ${duration}ms ease-out ${delay}ms`;
    shape.style.strokeDashoffset = '0';
  });
}

function buildMark(mark) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `mark is-${mark.toLowerCase()}`);

  if (mark === 'X') {
    [[28, 28, 72, 72], [72, 28, 28, 72]].forEach(([x1, y1, x2, y2], i) => {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.dataset.duration = '150';
      line.dataset.delay = String(i * 130);
      svg.appendChild(line);
    });
  } else {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', '27');
    circle.dataset.duration = '320';
    circle.dataset.delay = '0';
    svg.appendChild(circle);
  }
  return svg;
}

/** Must run once the mark is in the document — getTotalLength needs a rendered element. */
function animateMark(svg) {
  svg.querySelectorAll('line, circle').forEach((shape) => {
    drawStroke(shape, Number(shape.dataset.duration), Number(shape.dataset.delay));
  });
}

/** Scores through the winning row, the way you would with a pen. */
function drawStrike(result) {
  const centre = (i) => [(i % 3) * 100 + 50, Math.floor(i / 3) * 100 + 50];
  const [ax, ay] = centre(result.line[0]);
  const [bx, by] = centre(result.line[2]);
  const span = Math.hypot(bx - ax, by - ay);
  const [ox, oy] = [((bx - ax) / span) * 26, ((by - ay) / span) * 26];

  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', ax - ox);
  line.setAttribute('y1', ay - oy);
  line.setAttribute('x2', bx + ox);
  line.setAttribute('y2', by + oy);
  line.setAttribute('stroke', `var(--${result.mark.toLowerCase()})`);
  strikeEl.appendChild(line);
  drawStroke(line, 340, 160);
}

/* --------------------------------------------------------------- cells */

const cells = Array.from({ length: 9 }, (_, i) => {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'cell';
  cell.dataset.index = String(i);
  cell.setAttribute('role', 'gridcell');
  cell.tabIndex = i === 0 ? 0 : -1;
  boardEl.appendChild(cell);
  return cell;
});

function cellLabel(index, mark) {
  const where = `row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}`;
  return mark ? `${where}: ${mark}` : `${where}: empty`;
}

function render(winningLine = null) {
  boardEl.classList.toggle('has-win', Boolean(winningLine));

  state.board.forEach((mark, i) => {
    const cell = cells[i];

    // Only touch the DOM when a square actually changed, so marks are not redrawn.
    if (cell.dataset.mark !== mark) {
      cell.dataset.mark = mark;
      cell.replaceChildren();
      if (mark) animateMark(cell.appendChild(buildMark(mark)));
      cell.setAttribute('aria-label', cellLabel(i, mark));
    }

    cell.classList.toggle('is-win', Boolean(winningLine) && winningLine.includes(i));
    cell.disabled = Boolean(mark) || state.over || state.locked;
  });
}

function setStatus(text, tone = '') {
  statusEl.textContent = text;
  statusEl.className = 'masthead__status' + (tone ? ` is-${tone}` : '');
}

/* ------------------------------------------------------------ game flow */

function finish(result) {
  state.over = true;

  if (result) {
    state.scores[result.mark] += 1;
    const who = playerName(result.mark);
    setStatus(who === 'You' ? 'You win.' : `${who} wins.`, result.mark.toLowerCase());
  } else {
    state.scores.draw += 1;
    setStatus('A draw.');
  }

  updateScoreboard();
  render(result ? result.line : null);
  if (result) drawStrike(result);
  focusFirstPlayableCell();
}

function play(index) {
  if (state.over || state.locked || state.board[index]) return;

  state.board[index] = state.turn;
  const result = winnerOf(state.board);

  if (result) return finish(result);
  if (emptyCells(state.board).length === 0) return finish(null);

  state.turn = opponent(state.turn);
  render();
  announceTurn();

  if (state.mode === 'cpu' && state.turn === CPU) cpuTurn();
}

function announceTurn() {
  const who = playerName(state.turn);
  setStatus(who === 'You' ? 'Your move' : `${who} to move`, state.turn.toLowerCase());
}

function newRound({ focusBoard = true } = {}) {
  state.board = Array(9).fill('');
  state.turn = HUMAN;
  state.over = false;
  state.locked = false;
  strikeEl.replaceChildren();
  render();
  announceTurn();
  cells.forEach((cell, i) => { cell.tabIndex = i === 0 ? 0 : -1; });
  if (focusBoard) cells[0].focus({ preventScroll: true });
}

function updateScoreboard() {
  scoreEls.X.textContent = String(state.scores.X);
  scoreEls.O.textContent = String(state.scores.O);
  scoreEls.draw.textContent = String(state.scores.draw);
  nameEls.X.textContent = state.mode === 'cpu' ? 'You' : 'X';
  nameEls.O.textContent = state.mode === 'cpu' ? 'Computer' : 'O';
}

/* ------------------------------------------------------------- controls */

function selectChoice(group, attr, value) {
  group.querySelectorAll('.choice').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset[attr] === value));
  });
}

document.querySelectorAll('.choice').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.closest('.choices');

    if (btn.dataset.mode) {
      state.mode = btn.dataset.mode;
      selectChoice(group, 'mode', state.mode);
      difficultyControl.classList.toggle('is-hidden', state.mode !== 'cpu');
      state.scores = { X: 0, O: 0, draw: 0 };
    } else {
      state.difficulty = btn.dataset.difficulty;
      selectChoice(group, 'difficulty', state.difficulty);
    }
    updateScoreboard();
    newRound();
  });
});

document.getElementById('new-round').addEventListener('click', () => newRound());

document.getElementById('reset-score').addEventListener('click', () => {
  state.scores = { X: 0, O: 0, draw: 0 };
  updateScoreboard();
  newRound();
});

/* ---------------------------------------------------- keyboard handling */

function focusFirstPlayableCell() {
  const target = cells.find((cell) => !cell.disabled) || cells[0];
  cells.forEach((cell) => { cell.tabIndex = cell === target ? 0 : -1; });
}

const ARROWS = {
  ArrowRight: (i) => (i % 3 === 2 ? i - 2 : i + 1),
  ArrowLeft: (i) => (i % 3 === 0 ? i + 2 : i - 1),
  ArrowDown: (i) => (i + 3) % 9,
  ArrowUp: (i) => (i + 6) % 9,
};

boardEl.addEventListener('keydown', (event) => {
  const move = ARROWS[event.key];
  if (!move) return;

  const current = Number(event.target.dataset.index);
  if (Number.isNaN(current)) return;

  event.preventDefault();
  const next = cells[move(current)];
  cells.forEach((cell) => { cell.tabIndex = cell === next ? 0 : -1; });
  next.focus({ preventScroll: true });
});

boardEl.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (cell) play(Number(cell.dataset.index));
});

/* ----------------------------------------------------------------- init */

updateScoreboard();
newRound({ focusBoard: false });
