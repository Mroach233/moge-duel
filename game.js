(function () {
  'use strict';

  const rules = window.InkRules;
  const { COLS, ROWS, ROUNDS } = rules;
  const trial = readTrial();
  const byId = (id) => document.getElementById(id);
  const setupView = byId('setup-view');
  const battleView = byId('battle-view');
  const setupButton = byId('open-setup');
  const trialReplay = byId('trial-replay');
  const board = byId('board');
  const arena = board.parentElement;
  const hand = byId('hand');
  const rotateButton = byId('rotate');
  const specialButton = byId('special');
  const specialHint = byId('special-hint');
  const actionToast = byId('action-toast');
  const passButton = byId('pass');
  const submitButton = byId('submit');
  const status = byId('placement-status');
  const phase = byId('phase');
  const rulesDialog = byId('rules-dialog');
  const resultDialog = byId('result-dialog');
  const columnName = (x) => String.fromCharCode(65 + x);
  const twoDigits = (number) => String(number).padStart(2, '0');
  const positionName = ({ x, y }) => columnName(x) + twoDigits(y + 1);
  const boardPosition = (index) => ({ x: index % COLS, y: Math.floor(index / COLS) });

  arena.style.setProperty('--cols', COLS);
  arena.style.setProperty('--rows', ROWS);

  const tiles = Array.from({ length: ROWS * COLS }, (_, index) => {
    const tile = document.createElement('div');
    tile.dataset.cell = index;
    tile.setAttribute('aria-hidden', 'true');
    return tile;
  });
  board.append(...tiles);

  for (let x = 0; x < COLS; x += 1) {
    const label = document.createElement('span');
    label.textContent = columnName(x);
    byId('board-columns').append(label);
  }
  for (let y = 0; y < ROWS; y += 1) {
    const label = document.createElement('span');
    label.textContent = twoDigits(y + 1);
    byId('board-rows').append(label);
  }

  const roundMarks = Array.from({ length: ROUNDS }, () => document.createElement('i'));
  byId('round-track').append(...roundMarks);

  const cards = Array.from({ length: 4 }, (_, slot) => {
    const button = document.createElement('button');
    button.className = 'card';
    button.type = 'button';
    button.addEventListener('click', () => selectCard(slot));
    return button;
  });
  hand.append(...cards);

  let game;
  let activeConfig;
  let matchRandom;
  let openingTarget;
  let cpuMove;
  let lastTurn;
  let slot;
  let rotation;
  let attack;
  let locked;
  let hovered;
  let revealTimer;
  let toastTimer;
  let resultPending = false;
  let previewTiles = [];
  let targetTile;

  function readTrial() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('trial');
    if (mode !== 'bridge-a' && mode !== 'bridge-b') return null;
    const rawSeed = params.get('seed') ?? '';
    const seed = Number(rawSeed);
    return {
      bridgeOrigins: mode === 'bridge-b',
      seed: /^[0-9]+$/.test(rawSeed) && seed >= 1 && seed <= 0xffffffff ? seed : 1,
    };
  }

  function seededRandom(seed) {
    let state = seed;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function showBattle() {
    setupView.hidden = true;
    battleView.hidden = false;
    setupButton.hidden = Boolean(trial);
    window.scrollTo(0, 0);
    board.focus({ preventScroll: true });
  }

  function showSetup() {
    hideActionToast();
    if (resultDialog.open) resultDialog.close();
    battleView.hidden = true;
    setupButton.hidden = true;
    setup.show(!game.finished);
    window.scrollTo(0, 0);
  }

  function startGame(config) {
    hideActionToast();
    const random = trial ? seededRandom(trial.seed) : Math.random;
    const next = rules.createGame(random, config);
    clearTimeout(revealTimer);
    revealTimer = null;
    resultPending = false;
    if (resultDialog.open) resultDialog.close();
    game = next;
    activeConfig = config;
    matchRandom = random;
    cpuMove = rules.chooseCpuMove(game, matchRandom);
    trialReplay.hidden = true;
    lastTurn = null;
    slot = 0;
    resetPlacement();
    openingTarget = suggestOpeningTarget();
    byId('board-title').textContent = game.map.name;
    byId('battle-difficulty').textContent = game.difficulty.name;
    byId('bridge-legend').hidden = game.map.bridgeCells.size === 0;
    board.setAttribute('aria-label', `${game.map.name}占地棋盘`);
    renderGame();
    showBattle();
  }

  function resetPlacement() {
    rotation = 0;
    attack = false;
    locked = null;
    hovered = null;
  }

  function canPlay() {
    return Boolean(game && !game.finished && revealTimer === null);
  }

  function renderScore() {
    const counts = rules.score(game.board);
    for (const side of ['player', 'cpu']) {
      byId(`${side}-score`).textContent = twoDigits(counts[side]);
      const sp = byId(`${side}-sp`);
      sp.querySelector('strong').textContent = game.players[side].sp;
      sp.setAttribute('aria-label', `${game.players[side].sp} 点特殊能量`);
    }

    byId('round-number').textContent = twoDigits(game.round);
    byId('round-label').textContent = game.finished ? '终局' : '回合';
    for (const [index, mark] of roundMarks.entries()) {
      const turn = index + 1;
      mark.className = game.finished || turn < game.round ? 'done' : turn === game.round ? 'current' : '';
    }

    const bar = byId('turf-bar');
    bar.children[0].style.width = `${counts.player / counts.playable * 100}%`;
    bar.children[1].style.width = `${counts.cpu / counts.playable * 100}%`;
    bar.setAttribute('aria-label', `玩家占 ${counts.player} 格，电脑占 ${counts.cpu} 格，地图共 ${counts.playable} 格`);
  }

  function renderBoard() {
    const newlyPainted = new Set(lastTurn ? [...lastTurn.painted, ...lastTurn.charged] : []);
    for (const [index, tile] of game.board.entries()) {
      const classes = ['tile', tile.kind];
      if (tile.owner) classes.push(tile.owner);
      if (tile.charged) classes.push('charged');
      if (newlyPainted.has(index)) classes.push('latest');
      const element = tiles[index];
      if (game.map.bridgeCells.has(index)) {
        classes.push('bridge-point');
        const owner = tile.owner === 'player' ? '己方占领' : '电脑占领';
        const state = tile.owner ? owner : tile.kind === 'clash' ? '已封锁' : '待占领';
        element.title = `${positionName(boardPosition(index))} 桥格 · ${state}`;
      } else {
        element.removeAttribute('title');
      }
      element.className = classes.join(' ');
    }
  }

  function renderHand() {
    const player = game.players.player;
    byId('deck-count').textContent = player.pile.length;

    for (const [index, button] of cards.entries()) {
      const card = player.hand[index];
      button.hidden = !card;
      if (!card) continue;
      const selected = index === slot;
      button.disabled = !canPlay();
      button.setAttribute('aria-pressed', selected);
      button.setAttribute('aria-label', `${card.name}，${card.size} 格，特殊攻击消耗 ${card.cost} SP`);
      button.innerHTML = cardMarkup(card, selected ? rotation : 0, `<kbd>${index + 1}</kbd>`);
    }
  }

  function shapeCells(pose) {
    return pose.cells.map(({ x, y, core }) => (
      `<i${core ? ' class="mini-core"' : ''} style="grid-column:${x + 1};grid-row:${y + 1}"></i>`
    )).join('');
  }

  function cardMarkup(card, turn, marker) {
    const pose = card.rotations[turn];
    return `
      <span class="card-top"><span class="card-size">${card.size}<small>格</small></span>${marker}</span>
      <span class="mini-shape${Math.max(pose.width, pose.height) > 4 ? ' long-shape' : ''}" aria-hidden="true">${shapeCells(pose)}</span>
      <span class="card-bottom"><span class="card-name">${card.name}</span><span class="card-cost"><span aria-hidden="true">◇</span> ${card.cost} SP</span></span>`;
  }

  function renderNextDraw() {
    const card = trial || game.finished ? undefined : game.players.player.pile.at(-1);
    byId('next-draw').hidden = !card;
    byId('next-draw-name').textContent = card?.name ?? '';
    byId('next-draw-shape').innerHTML = card ? shapeCells(card.rotations[0]) : '';
  }

  function suggestOpeningTarget() {
    const start = game.map.playerStart;
    const preferred = { x: start.x + 3, y: start.y };
    if (!rules.inspectMove(game, 'player', makeMove(preferred)).error) return preferred;
    for (let index = 0; index < tiles.length; index += 1) {
      const target = boardPosition(index);
      if (!rules.inspectMove(game, 'player', makeMove(target)).error) return target;
    }
    return null;
  }

  function openingPreview() {
    return !lastTurn && slot === 0 && rotation === 0 && !attack ? openingTarget : null;
  }

  function makeMove(target) {
    return { ...target, slot, rotation, attack };
  }

  function renderPreview() {
    for (const cell of previewTiles) {
      cell.classList.remove('preview', 'preview-core', 'locked', 'invalid', 'attacking');
    }
    previewTiles = [];
    if (targetTile) targetTile.removeAttribute('data-target');
    targetTile = null;

    const target = canPlay() ? locked ?? hovered ?? openingPreview() : null;
    const preview = target ? rules.inspectMove(game, 'player', makeMove(target)) : null;
    if (preview) {
      for (const cell of preview.cells) {
        if (!rules.inBounds(cell.x, cell.y)) continue;
        const element = tiles[cell.y * COLS + cell.x];
        element.classList.add('preview');
        if (cell.core) element.classList.add('preview-core');
        if (locked) element.classList.add('locked');
        if (attack) element.classList.add('attacking');
        if (preview.error) element.classList.add('invalid');
        previewTiles.push(element);
      }
      targetTile = tiles[target.y * COLS + target.x];
      targetTile.setAttribute('data-target', '');
    }
    renderControls(preview);
  }

  function renderControls(preview) {
    const player = game.players.player;
    const card = player.hand[slot];
    const ready = canPlay() && Boolean(card);
    const bridgeMap = game.map.bridgeCells.size > 0;
    const attackOrigin = bridgeMap ? '己方特殊格或己方桥格' : '己方特殊格';
    setupButton.disabled = revealTimer !== null;
    rotateButton.disabled = !ready;
    passButton.disabled = !ready;
    specialButton.disabled = !ready || player.sp < card.cost;
    specialButton.setAttribute('aria-pressed', attack);
    specialButton.title = card ? `消耗 ${card.cost} SP · 紧贴${attackOrigin}` : '';
    let hint = '';
    if (ready && !attack) {
      hint = player.sp < card.cost
        ? `本牌需 ${card.cost} SP，还差 ${card.cost - player.sp} SP。围满特殊格周围 8 格或弃牌，各得 1 SP。`
        : `可发动特攻，消耗 ${card.cost} SP。紧贴${attackOrigin}落子。`;
    }
    specialHint.hidden = !hint;
    if (specialHint.textContent !== hint) specialHint.textContent = hint;
    submitButton.disabled = !ready || !locked || !preview || Boolean(preview.error);
    submitButton.classList.toggle('attack', attack);
    submitButton.firstElementChild.textContent = attack ? '确认攻击' : '确认落子';

    let message = bridgeMap ? '点棋盘锁定落点。占下蓝框桥格，可从旁边发动特攻。' : '点棋盘锁定落点，虚线是落牌预览。';
    let state = '';
    if (game.finished) {
      message = trial ? '本局已结束，可重开同一场试玩。' : '本局已结束，可回到备战开启新对局。';
    } else if (!canPlay()) {
      message = '双方已锁牌，正在结算。';
    } else if (locked && preview.error) {
      const errors = {
        bounds: '卡牌超出棋盘。',
        wall: '卡牌碰到封锁格。',
        occupied: attack ? '特殊格会阻挡特殊攻击。' : '普通落子只能盖空格。',
        connection: attack ? `至少一格要贴到${attackOrigin}。` : '至少一格要贴到己方墨格。',
        charge: 'SP 不足。',
      };
      message = `${positionName(locked)} · ${errors[preview.error]}`;
      state = 'invalid';
    } else if (locked) {
      message = `${positionName(locked)} · ${attack ? `可攻击，消耗 ${card.cost} SP` : '可以落子'}`;
      state = attack ? 'attack' : 'valid';
    } else if (attack) {
      message = `消耗 ${card.cost} SP。贴着${attackOrigin}落子。`;
      state = 'attack';
    }
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = state;
    phase.classList.toggle('resolving', !canPlay() && !game.finished);
    phase.lastElementChild.textContent = game.finished ? '对局结束' : canPlay() ? '选择落点' : '揭晓中';
  }

  function renderLog() {
    const log = byId('turn-log');
    if (!lastTurn) {
      log.textContent = '落牌后，双方会一起揭晓。';
      return;
    }
    const actions = lastTurn.plans.map(({ side, card, move, gained, captured }) => {
      const play = move.pass ? `弃掉${card.name}` : `${card.name}${move.attack ? '·特攻' : ''}`;
      const change = lastTurn.scoreChanges[side];
      const score = `占格 ${change > 0 ? '+' : ''}${change}`;
      const capture = captured ? ` · 反涂 ${captured} 格` : '';
      const cost = move.attack && !move.pass ? ` · 消耗 ${card.cost} SP` : '';
      const energy = gained ? ` · 获得 ${gained} SP` : '';
      return `<span class="turn-action ${side}-note">${side === 'player' ? '你' : '电脑'} ${play} · ${score}${capture}${cost}${energy}</span>`;
    });
    const clash = lastTurn.collisions ? `　撞格 ${lastTurn.collisions}` : '';
    const blocked = lastTurn.blocked ? `（封锁 ${lastTurn.blocked}）` : '';
    log.innerHTML = `<b>第 ${lastTurn.round} 回合</b>${clash}${blocked}${actions.join('')}`;
  }

  function renderGame() {
    renderScore();
    renderBoard();
    renderHand();
    renderNextDraw();
    renderPreview();
    renderLog();
  }

  function selectCard(index) {
    if (!canPlay() || index === slot) return;
    const card = game.players.player.hand[index];
    if (!card) return;
    hideActionToast();
    slot = index;
    rotation = 0;
    if (game.players.player.sp < card.cost) attack = false;
    renderHand();
    renderPreview();
  }

  function rotateCard(direction) {
    if (!canPlay()) return;
    rotation = (rotation + direction + 4) % 4;
    renderHand();
    renderPreview();
  }

  function hideActionToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    actionToast.hidden = true;
    actionToast.textContent = '';
  }

  function showActionToast(message) {
    hideActionToast();
    actionToast.textContent = message;
    actionToast.hidden = false;
    toastTimer = setTimeout(hideActionToast, 2000);
  }

  function toggleSpecial() {
    if (!canPlay() || battleView.hidden || rulesDialog.open) return;
    const player = game.players.player;
    const card = player.hand[slot];
    if (!card) return;
    if (player.sp < card.cost) {
      showActionToast(`SP 不足，本牌需 ${card.cost} SP，还差 ${card.cost - player.sp} SP。`);
      return;
    }
    hideActionToast();
    attack = !attack;
    renderPreview();
  }

  function showResult() {
    const counts = rules.score(game.board);
    const won = counts.player > counts.cpu;
    const unlocked = won && !trial ? setup.awardVictory() : [];
    byId('result-title').textContent = won ? '你赢了！' : counts.player < counts.cpu ? '电脑获胜' : '平局';
    byId('result-player').textContent = counts.player;
    byId('result-cpu').textContent = counts.cpu;
    byId('result-unlocks').hidden = unlocked.length === 0;
    trialReplay.hidden = !trial;
    byId('reward-list').replaceChildren(...unlocked.map(({ type, name }) => {
      const reward = document.createElement('li');
      reward.innerHTML = `<span>${type}</span><strong>${name}</strong>`;
      return reward;
    }));
    resultPending = rulesDialog.open;
    if (!resultPending) resultDialog.showModal();
  }

  function play(move) {
    if (!canPlay() || rules.inspectMove(game, 'player', move).error) return;
    hideActionToast();
    revealTimer = setTimeout(() => {
      const before = rules.score(game.board);
      lastTurn = rules.resolveTurn(game, { player: move, cpu: cpuMove });
      const after = rules.score(game.board);
      lastTurn.scoreChanges = {
        player: after.player - before.player,
        cpu: after.cpu - before.cpu,
      };
      revealTimer = null;
      slot = Math.min(slot, game.players.player.hand.length - 1);
      resetPlacement();
      if (!game.finished) cpuMove = rules.chooseCpuMove(game, matchRandom);
      renderGame();
      if (game.finished) showResult();
    }, 240);
    renderHand();
    renderPreview();
  }

  function pointFromEvent(event) {
    const tile = event.target.closest('[data-cell]');
    return tile ? boardPosition(Number(tile.dataset.cell)) : null;
  }

  function setTarget(target) {
    locked = target;
    hovered = null;
    board.focus({ preventScroll: true });
    renderPreview();
  }

  board.addEventListener('pointermove', (event) => {
    if (!canPlay() || locked || event.pointerType === 'touch') return;
    const target = pointFromEvent(event);
    if (!target || (target.x === hovered?.x && target.y === hovered?.y)) return;
    hovered = target;
    renderPreview();
  });
  board.addEventListener('pointerleave', () => {
    if (!hovered) return;
    hovered = null;
    renderPreview();
  });
  board.addEventListener('click', (event) => {
    const target = pointFromEvent(event);
    if (target && canPlay()) setTarget(target);
  });

  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  window.addEventListener('keydown', (event) => {
    if (battleView.hidden || !canPlay() || rulesDialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const step = arrows[event.key];
    if (/^[1-4]$/.test(key)) {
      selectCard(Number(key) - 1);
    } else if (key === 'r') {
      rotateCard(event.shiftKey ? -1 : 1);
    } else if (key === 'e') {
      event.preventDefault();
      if (!event.repeat) toggleSpecial();
    } else if (key === 'escape' && locked) {
      locked = null;
      renderPreview();
    } else if (step && (event.target === board || event.target === document.body || hand.contains(event.target))) {
      event.preventDefault();
      const target = locked ?? hovered ?? openingTarget ?? game.map.playerStart;
      const x = target.x + step[0];
      const y = target.y + step[1];
      if (rules.inBounds(x, y)) setTarget({ x, y });
    } else if (key === 'enter' && event.target === board && !submitButton.disabled) {
      event.preventDefault();
      play(makeMove(locked));
    }
  });

  rotateButton.addEventListener('click', () => rotateCard(1));
  specialButton.addEventListener('click', toggleSpecial);
  passButton.addEventListener('click', () => play({ slot, pass: true }));
  submitButton.addEventListener('click', () => {
    if (locked) play(makeMove(locked));
  });
  byId('show-rules').addEventListener('click', () => {
    hideActionToast();
    rulesDialog.showModal();
  });
  rulesDialog.addEventListener('close', () => {
    if (!resultPending) return;
    resultPending = false;
    resultDialog.showModal();
  });
  const replayButton = byId('play-again');
  replayButton.addEventListener('click', () => startGame(activeConfig));
  const setup = trial ? null : window.createInkSetup({ startMatch: startGame, resumeMatch: showBattle, cardMarkup });
  if (trial) {
    byId('trial-label').hidden = false;
    byId('rule-bridge').hidden = !trial.bridgeOrigins;
    byId('rule-deck-setup').hidden = true;
    byId('rule-rewards').hidden = true;
    byId('result-setup').hidden = true;
    replayButton.classList.replace('quiet', 'primary');
    trialReplay.addEventListener('click', () => startGame(activeConfig));
    startGame({ mapId: 'bridge', difficultyId: 'standard', bridgeOrigins: trial.bridgeOrigins });
  } else {
    setupButton.addEventListener('click', showSetup);
    byId('result-setup').addEventListener('click', showSetup);
  }
})();
