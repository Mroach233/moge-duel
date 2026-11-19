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
  const specialLabel = specialButton.querySelector('.special-label');
  const actionToast = byId('action-toast');
  const passButton = byId('pass');
  const mulliganButton = byId('mulligan');
  const submitButton = byId('submit');
  const status = byId('placement-status');
  const legend = byId('board-legend');
  const phase = byId('phase');
  const rulesDialog = byId('rules-dialog');
  const resultDialog = byId('result-dialog');
  const rulesTutorialButton = byId('rules-tutorial');
  const tutorialNextButton = byId('tutorial-next');
  const tutorialSkipButton = byId('tutorial-skip');
  const tutorialProgress = byId('tutorial-progress');
  const rulesTutorialConfirm = byId('rules-tutorial-confirm');
  const rulesTutorialCancel = byId('rules-tutorial-cancel');
  const rulesTutorialStart = byId('rules-tutorial-start');
  const replayTutorialButton = byId('replay-tutorial');
  const setupTutorialConfirm = byId('setup-tutorial-confirm');
  const setupTutorialCancel = byId('setup-tutorial-cancel');
  const setupTutorialStart = byId('setup-tutorial-start');
  const rotateLabel = rotateButton.children[1];
  const roundTotal = document.querySelector('.round-total');
  const inputHint = document.querySelector('.input-hint');
  const inputHintDefault = inputHint.innerHTML;
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
    button.addEventListener('click', (event) => {
      if (drag.pendingClick) {
        event.preventDefault();
        return;
      }
      selectCard(slot);
    });
    button.addEventListener('pointerdown', (event) => beginDragPress(event, slot));
    return button;
  });
  hand.append(...cards);

  const dragGhost = document.createElement('div');
  dragGhost.id = 'drag-ghost';
  dragGhost.setAttribute('aria-hidden', 'true');
  dragGhost.hidden = true;
  battleView.append(dragGhost);

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
  let legality = [];
  let revealTimer;
  let toastTimer;
  let resultPending = false;
  let previewTiles = [];
  let targetTile;
  // Scripted tutorial state (design 附录 B.2). Data lives in tutorial.js;
  // this controller only drives the shared battle UI.
  const tutData = trial ? null : window.InkTutorial ?? null;
  const tutorial = {
    active: false,
    replay: false,
    config: null, // formal startGame config for after the tutorial
    index: 0,
    phase: 'place', // place | reveal | explain
    step: null,
    errors: 0,
  };
  let sessionTutorialDone = false;
  let skipResetTimer = null;
  // Drag state: press -> (moved >= threshold) dragging -> drop/cancel.
  const drag = {
    enabled: readDragFlag(),
    pointerId: null,
    slot: null,
    startX: 0,
    startY: 0,
    active: false,
    // Snapshot of the pre-drag selection so cancel can restore it exactly.
    prevSlot: null,
    prevRotation: 0,
    prevAttack: false,
    prevLocked: null,
    // Rotation of the dragged card at press time (ghost rendering).
    dragRotation: 0,
    pendingClick: false,
    frame: null,
    lastX: 0,
    lastY: 0,
  };

  function readDragFlag() {
    try {
      return new URLSearchParams(window.location.search).get('drag') !== '0';
    } catch {
      return true;
    }
  }

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
    setupButton.hidden = Boolean(trial) || tutorial.active;
    window.scrollTo(0, 0);
    board.focus({ preventScroll: true });
  }

  function showSetup() {
    hideActionToast();
    if (resultDialog.open) resultDialog.close();
    resetSetupTutorialConfirm();
    battleView.hidden = true;
    setupButton.hidden = true;
    setup.show(!game || !game.finished);
    window.scrollTo(0, 0);
  }

  // =====================================================================
  // Scripted tutorial controller (design 教学关-v1.1 附录 B.2/B.3).
  // Reuses the battle UI (board, hand, action bar); a tutorial game is
  // created fresh per step and only the scripted inputs are accepted.
  // =====================================================================

  function readTutorialDone() {
    try {
      return localStorage.getItem(tutData.TUTORIAL_KEY) === '1';
    } catch {
      return false; // storage broken: treat as not done, session flag guards
    }
  }

  function markTutorialDone() {
    sessionTutorialDone = true; // session guard first: storage may be broken
    try {
      localStorage.setItem(tutData.TUTORIAL_KEY, '1');
    } catch {
      // ignore; sessionTutorialDone keeps this session clean
    }
  }

  function readTutorialParam() {
    try {
      const value = new URLSearchParams(window.location.search).get('tutorial');
      if (value === '0') return false; // QA: force-skip auto tutorial
      if (value === '1') return true; // QA: force-run even if marked done
    } catch {
      // ignore; fall through to normal rules
    }
    return null;
  }

  // Boot-time hook (design B.3): non-trial, not done, not session-done ->
  // hide setup and jump straight into tutorial step 1.
  function maybeStartTutorialOnBoot() {
    if (!tutData || trial || sessionTutorialDone) return false;
    const forced = readTutorialParam();
    if (forced === false) return false;
    if (forced === true) {
      startTutorial({ replay: false, config: { mapId: 'practice', difficultyId: 'rookie', deckIds: null } });
      return true;
    }
    if (readTutorialDone()) return false;
    startTutorial({ replay: false, config: { mapId: 'practice', difficultyId: 'rookie', deckIds: null } });
    return true;
  }

  function tutorialTarget() {
    return { x: tutorial.step.player.x, y: tutorial.step.player.y };
  }

  function tutorialScriptedCard() {
    return tutorial.step.player.slot;
  }

  function tutorialRotationAllowed() {
    return tutorial.step.id === '01' || tutorial.step.id === '02';
  }

  function tutorialAttackAllowed() {
    return tutorial.step.id === '05';
  }

  // Inline confirms (design 1.4/5.3): no window.confirm anywhere. Both
  // "watch the tutorial" entries reset their confirm area whenever the
  // surrounding surface opens/closes or the tutorial state changes.
  function resetRulesTutorialConfirm() {
    rulesTutorialConfirm.hidden = true;
    // Trial mode has no tutorial and no click handler on the button: keep
    // it hidden there too (trial hides it at boot).
    if (!tutorial.active && !trial) rulesTutorialButton.hidden = false;
  }

  function resetSetupTutorialConfirm() {
    setupTutorialConfirm.hidden = true;
    replayTutorialButton.hidden = false;
  }

  function startTutorial({ replay, config }) {
    if (tutorial.active) return; // double-tap on the confirm's "开始教学"
    // A formal reveal in flight (240ms) must never fire resolveTurn into
    // the tutorial board.
    clearTimeout(revealTimer);
    revealTimer = null;
    tutorial.active = true;
    tutorial.replay = Boolean(replay);
    tutorial.config = config ?? setup.getLoadout();
    tutorial.index = 0;
    tutorial.errors = 0;
    document.body.classList.add('tutorial-mode');
    setupView.hidden = true;
    // A replay start must never land under a stale result/rules overlay
    // (e.g. entered from a finished match while the result was pending).
    hideActionToast();
    resultPending = false;
    if (resultDialog.open) resultDialog.close();
    if (rulesDialog.open) rulesDialog.close();
    resetRulesTutorialConfirm();
    resetSetupTutorialConfirm();
    showTutorialStep();
  }

  // Load one step: fresh game, scripted slot selected, rotation preset.
  function showTutorialStep() {
    const step = tutData.TUTORIAL_STEPS[tutorial.index];
    tutorial.step = step;
    tutorial.phase = 'place';
    tutorial.errors = 0;
    tutorial.locked = false;
    // New step: disarm any two-stage skip so label and state stay in sync.
    clearTimeout(skipResetTimer);
    skipResetTimer = null;
    game = tutData.createTutorialGame(step);
    cpuMove = { ...step.cpu };
    slot = step.player.slot;
    rotation = step.id === '01' || step.id === '02' ? 0 : step.player.rotation;
    attack = false;
    locked = null;
    hovered = null;
    legality = game.players.player.hand.map(() => true);
    lastTurn = null;
    revealTimer = null;
    openingTarget = null;
    // Progress lives in the topbar and round block (design 4.1); the board
    // title stays short so it never wraps at 320.
    byId('board-title').textContent = `${step.id} ${step.title}`;
    // Per-step chrome that formal startGame owns elsewhere: legend, map
    // difficulty, hint line, round block, round track.
    byId('board-legend').classList.remove('attack-mode');
    byId('bridge-legend').hidden = game.map.bridgeCells.size === 0;
    byId('battle-difficulty').textContent = game.difficulty.name;
    inputHint.innerHTML = '点高亮格 · 可跳过教学';
    byId('round-track').hidden = step.id !== '06';
    board.setAttribute('aria-label', `${step.title}教学棋盘`);
    renderGame();
    showBattle();
    tutorialRenderChrome();
    tutorialRenderStatus(step.instruction, '');
  }

  // Confirm the scripted move: only an exact {slot, rotation, x, y, attack}
  // match advances. Wrong choices get a short hint, never a silent block.
  function tutorialConfirm() {
    if (tutorial.phase !== 'place' || revealTimer !== null) return;
    const step = tutorial.step;
    const scripted = step.player;
    if (slot !== scripted.slot) {
      tutorialHint(step.hint.card);
      return;
    }
    if (rotation !== scripted.rotation) {
      tutorialHint(tutorialRotationAllowed()
        ? step.hint.rotation ?? `转不到位：这一步要 r${scripted.rotation}。`
        : '方向已由本步固定。');
      return;
    }
    if (attack !== scripted.attack) {
      tutorialHint(scripted.attack ? step.hint.target : '特攻后面再学，本步先普通落子。');
      return;
    }
    if (!locked) {
      tutorialHint(step.hint.target);
      return;
    }
    if (locked.x !== scripted.x || locked.y !== scripted.y) {
      tutorialHint(step.hint.target);
      return;
    }
    tutorial.phase = 'reveal';
    renderHand();
    renderPreview();
    renderControls(null);
    revealTimer = setTimeout(() => {
      const before = rules.score(game.board);
      const report = rules.resolveTurn(game, { player: { ...scripted }, cpu: { ...step.cpu } });
      const after = rules.score(game.board);
      lastTurn = report;
      lastTurn.scoreChanges = {
        player: after.player - before.player,
        cpu: after.cpu - before.cpu,
      };
      tutorial.lastReport = report;
      tutorial.lastTurnScoreChange = lastTurn.scoreChanges;
      revealTimer = null;
      tutorial.phase = 'explain';
      resetPlacement();
      legality = game.players.player.hand.map(() => true);
      slot = scripted.slot;
      rotation = scripted.rotation;
      attack = false;
      renderGame();
      tutorialRenderChrome();
      // Step 6 ends with a readable verdict instead of a generic pointer.
      tutorialRenderStatus(step.id === '06'
        ? '终局 51:50，你赢 1 格；点「进入对局」。'
        : '本步结算如上。', 'valid');
      // Step 6 shows the final 51:50; the formal result dialog is skipped.
    }, 240);
  }

  function tutorialHint(message) {
    tutorial.errors += 1;
    const suffix = tutorial.errors >= 3 ? '（也可以「跳过」）' : '';
    tutorialRenderStatus(`${message}${suffix}`, 'invalid');
  }

  // "下一步" / "进入对局" after the reveal.
  function tutorialNext() {
    if (!tutorial.active || tutorial.phase !== 'explain') return; // double-tap guard
    if (tutorial.index < tutData.TUTORIAL_STEPS.length - 1) {
      tutorial.index += 1;
      showTutorialStep();
    } else {
      tutorialComplete();
    }
  }

  function tutorialComplete() {
    if (!tutorial.replay) markTutorialDone();
    tutorialCleanup();
    startGame(tutorial.config);
  }

  function tutorialSkip() {
    if (!tutorial.active) return;
    // Two-stage confirm: first click arms, second within 2s executes.
    if (skipResetTimer === null) {
      tutorialSkipButton.textContent = '再点一次';
      skipResetTimer = setTimeout(() => {
        skipResetTimer = null;
        tutorialSkipButton.textContent = '跳过';
      }, 2000);
      return;
    }
    clearTimeout(skipResetTimer);
    skipResetTimer = null;
    if (!tutorial.replay) markTutorialDone();
    tutorialCleanup();
    startGame(tutorial.config);
  }

  function tutorialCleanup() {
    tutorial.active = false;
    tutorial.step = null;
    legend.classList.remove('attack-mode'); // legend never leaks into formal play
    tutorial.phase = 'place'; // double-tap guard: no stale explain phase
    clearTimeout(skipResetTimer);
    skipResetTimer = null;
    document.body.classList.remove('tutorial-mode');
    tutorialSkipButton.hidden = true;
    tutorialSkipButton.textContent = '跳过';
    byId('tutorial-tag').hidden = true;
    byId('round-track').hidden = false;
    roundTotal.textContent = ' / 12';
    rotateLabel.textContent = '旋转';
    rotateButton.title = '';
    inputHint.innerHTML = inputHintDefault;
    rulesTutorialButton.hidden = false;
    resetRulesTutorialConfirm();
    resetSetupTutorialConfirm();
    byId('rule-bridge').hidden = false;
    byId('rule-deck-setup').hidden = false;
    byId('rule-rewards').hidden = false;
    tutorialNextButton.hidden = true;
    // Restore the formal action-bar defaults the tutorial hid (design: the
    // formal match must never inherit tutorial visibility state).
    submitButton.hidden = false;
    submitButton.removeAttribute('aria-label');
    rotateButton.hidden = false;
    passButton.hidden = false;
    specialButton.hidden = false;
    document.querySelector('.hand-deck').hidden = false;
  }

  // Post-render chrome overrides: topbar, round block, hand/controls visibility.
  function tutorialRenderChrome() {
    const step = tutorial.step;
    if (!tutorial.active || !step) return;
    byId('tutorial-tag').hidden = false;
    tutorialProgress.textContent = `${tutorial.index + 1}/6`;
    tutorialSkipButton.hidden = false;
    // Only reset the label when no two-stage skip timer is armed; otherwise
    // the "再点一次" arm state would lose its text match.
    if (skipResetTimer === null) tutorialSkipButton.textContent = '跳过';
    // Tutorial hides formal-only chrome: mulligan, deck info, dimmed note,
    // trimmed rules entries and the rules-dialog tutorial button (which
    // stays hidden together with its inline confirm, design 4.1/5.3).
    byId('mulligan').hidden = true;
    byId('dimmed-note').hidden = true;
    document.querySelector('.hand-deck').hidden = true;
    byId('rule-bridge').hidden = true;
    byId('rule-deck-setup').hidden = true;
    byId('rule-rewards').hidden = true;
    rulesTutorialButton.hidden = true;
    rulesTutorialConfirm.hidden = true;
    // Round block: steps 1-5 = 教学 n/6 with the 12-dot track hidden;
    // step 6 = 终局 12/12 with the full track (design 4.1/4.2).
    byId('round-number').textContent = step.id === '06' ? '12' : String(tutorial.index + 1);
    byId('round-label').textContent = step.id === '06' ? '终局' : '教学';
    roundTotal.textContent = step.id === '06' ? ' / 12' : ' / 6';
    byId('round-track').hidden = step.id !== '06';
    if (step.id === '06') {
      // Round 11 is already played: place = 11 done + current (last mark),
      // explain = all 12 done.
      roundMarks.forEach((mark, index) => {
        mark.className = tutorial.phase === 'explain'
          ? 'done'
          : index === 11 ? 'current' : 'done';
      });
    }
  }

  // Status line + phase chip; called outside renderGame so hints survive.
  function tutorialRenderStatus(message, state) {
    if (!tutorial.active) return;
    status.textContent = message;
    status.dataset.state = state;
    phase.lastElementChild.textContent = tutorial.phase === 'place'
      ? '选择落点'
      : tutorial.phase === 'reveal' ? '同时揭晓' : '讲解';
    phase.classList.toggle('resolving', tutorial.phase === 'reveal');
  }

  // renderControls hook: action-bar buttons per step (design 4.1 item 4).
  function tutorialRenderControls(preview) {
    // Step 5 attack mode switches the board legend to the A4 attack key
    // (起点/反涂/不能落); other steps and non-attack state restore the
    // normal placement legend (showTutorialStep also clears it on entry).
    legend.classList.toggle('attack-mode', attack);
    const step = tutorial.step;
    const scripted = step.player;
    const ready = tutorial.phase === 'place' && revealTimer === null;
    rotateButton.hidden = !tutorialRotationAllowed();
    passButton.hidden = true;
    specialButton.hidden = !tutorialAttackAllowed();
    mulliganButton.hidden = true;
    if (tutorial.phase === 'explain') {
      submitButton.hidden = true;
      tutorialNextButton.hidden = false;
      tutorialNextButton.textContent = step.nextLabel;
      tutorialNextButton.setAttribute('aria-label', step.nextLabel);
      tutorialNextButton.disabled = revealTimer !== null;
      // Explain window: rotation/special are inert (design 4.2).
      rotateButton.disabled = true;
      specialButton.disabled = true;
    } else {
      tutorialNextButton.hidden = true;
      submitButton.hidden = false;
      // Reveal (240ms) disables; during placement the button stays
      // clickable so mismatches get a hint instead of a silent block.
      submitButton.disabled = !ready;
      submitButton.classList.toggle('attack', attack);
      submitButton.firstElementChild.textContent = attack ? '确认攻击' : '确认落子';
      submitButton.setAttribute('aria-label', attack ? '确认攻击' : '确认落子');
      const rotated = tutorialRotationAllowed() && rotation === scripted.rotation;
      rotateButton.disabled = !ready || rotated;
      rotateLabel.textContent = rotated ? '已转好' : '旋转';
      rotateButton.title = rotated ? '已转好' : '';
      // special button only clickable in step 5; toast explains elsewhere.
      // The formal is-locked/aria-disabled state must not leak into steps.
      specialButton.disabled = !ready || !tutorialAttackAllowed();
      specialButton.classList.remove('is-locked');
      specialButton.setAttribute('aria-disabled', 'false');
      const player = game.players.player;
      const card = player.hand[slot];
      specialLabel.textContent = card ? `特殊攻击 · ${card.cost} SP` : '特殊攻击';
      specialButton.setAttribute('aria-pressed', attack);
      // target preview requires exact anchor; wrong anchor gives normal ghost
      const onTarget = locked && locked.x === scripted.x && locked.y === scripted.y;
      submitButton.firstElementChild.textContent = attack ? '确认攻击' : '确认落子';
      submitButton.setAttribute('aria-label', attack ? '确认攻击' : '确认落子');
      let message = step.instruction;
      if (!ready) {
        message = '双方已锁牌，正在结算。';
      } else if (locked && !onTarget) {
        message = step.hint.target;
      } else if (locked) {
        message = `${positionName(locked)} · 可以确认`;
      }
      status.textContent = message;
      status.dataset.state = locked && !onTarget ? 'invalid' : '';
    }
    setupButton.disabled = revealTimer !== null;
  }

  // renderPreview hook: highlight the scripted anchor; other anchors show a
  // normal ghost preview so exploration never looks broken.
  function tutorialRenderPreview() {
    const step = tutorial.step;
    for (const tile of tiles) tile.classList.remove('tutorial-target');
    if (tutorial.phase !== 'place') return;
    const anchor = tutorialTarget();
    const anchorTile = tiles[anchor.y * COLS + anchor.x];
    anchorTile.classList.add('tutorial-target');
  }

  // renderHand hook: lock every card except the scripted one (design 4.3).
  function tutorialRenderHand() {
    const scripted = tutorialScriptedCard();
    cards.forEach((button, index) => {
      const isScript = index === scripted;
      button.disabled = !isScript || tutorial.phase !== 'place' || revealTimer !== null;
      button.setAttribute('aria-disabled', isScript ? 'false' : 'true');
      button.classList.toggle('tutorial-locked', !isScript);
      button.classList.toggle('tutorial-script', isScript);
    });
  }

  function startGame(config) {
    // Any formal startMatch ends the tutorial (the setup button is hidden
    // during the tutorial, so this only fires from scripted/programmatic
    // entries). Skip-style cleanup: persist, clear UI, start formal.
    if (tutorial.active) {
      if (!tutorial.replay) markTutorialDone();
      tutorialCleanup();
      hideActionToast();
      if (resultDialog.open) resultDialog.close();
      setupView.hidden = true;
    }
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
    // CPU takes its one-time opening mulligan before the first chooseCpuMove
    // so its planning already reflects any swap (engine decides, no undo).
    if (!trial && rules.shouldCpuMulligan(game)) rules.mulligan(game, 'cpu');
    cpuMove = rules.chooseCpuMove(game, matchRandom);
    trialReplay.hidden = true;
    lastTurn = null;
    slot = 0;
    resetPlacement();
    legality = computeLegality();
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

  // Recomputed once per turn (startGame / after resolveTurn), not on SP
  // changes — greying only depends on the board and the current hand.
  function computeLegality() {
    const player = game.players.player;
    return player.hand.map((card, slotIndex) => (
      card ? rules.hasAnyPlacement(game, 'player', slotIndex) : false
    ));
  }

  function canPlay() {
    if (tutorial.active) {
      // Step 6 ends with finished=true; the controller owns the phase gates.
      return tutorial.phase === 'place' && revealTimer === null;
    }
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
    if (tutorial.active) {
      // Tutorial: fixed hand, no deck info, scripted card only.
      player.hand.forEach((card, index) => {
        const button = cards[index];
        button.hidden = !card;
        if (!card) return;
        const selected = index === slot;
        button.setAttribute('aria-pressed', selected);
        button.setAttribute('aria-label', `${card.name}，${card.size} 格。${index === tutorialScriptedCard() ? '本步用这张' : '本步锁定，不可选'}。`);
        const marker = index === tutorialScriptedCard()
          ? '<span class="card-top-marker"><kbd>' + (index + 1) + '</kbd><span class="no-placement-mark" aria-hidden="true">本步用这张</span></span>'
          : '<span class="card-top-marker"><kbd>' + (index + 1) + '</kbd><span class="no-placement-mark" aria-hidden="true">锁定</span></span>';
        button.innerHTML = cardMarkup(card, index === slot ? rotation : 0, marker);
      });
      tutorialRenderHand();
      return;
    }
    byId('deck-count').textContent = player.pile.length;
    let dimmed = false;

    for (const [index, button] of cards.entries()) {
      const card = player.hand[index];
      button.hidden = !card;
      if (!card) continue;
      const selected = index === slot;
      const placeable = Boolean(legality[index]);
      dimmed ||= !placeable;
      button.disabled = !canPlay();
      button.classList.toggle('no-placement', !placeable);
      button.setAttribute('aria-pressed', selected);
      button.setAttribute('aria-label', `${card.name}，${card.size} 格。普通落子不需要能量；特殊攻击消耗 ${card.cost} SP。${placeable ? '' : '当前无合法落点。'}`);
      const marker = `<span class="card-top-marker"><kbd>${index + 1}</kbd>${placeable ? '' : '<span class="no-placement-mark" aria-hidden="true">无落点</span>'}</span>`;
      button.innerHTML = cardMarkup(card, selected ? rotation : 0, marker);
    }
    byId('dimmed-note').hidden = !dimmed;
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
      <span class="card-bottom"><span class="card-name">${card.name}</span><span class="card-cost"><span class="cost-tag" aria-hidden="true">特攻</span><span aria-hidden="true">◇</span>${card.cost}</span></span>`;
  }

  function renderNextDraw() {
    if (tutorial.active) {
      byId('next-draw').hidden = true;
      return;
    }
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
    return !drag.active && !lastTurn && slot === 0 && rotation === 0 && !attack ? openingTarget : null;
  }

  function makeMove(target) {
    return { ...target, slot, rotation, attack };
  }

  const ATk_CLASSES = ['atk-origin', 'atk-flip', 'atk-neutral', 'atk-blocked', 'atk-anchor'];

  function renderPreview() {
    if (tutorial.active) {
      const keepTiles = previewTiles;
      previewTiles = [];
      for (const tile of tiles) tile.classList.remove(...ATk_CLASSES);
      if (targetTile) targetTile.removeAttribute('data-target');
      targetTile = null;
      const scripted = tutorial.step.player;
      const target = tutorial.phase === 'place' && revealTimer === null ? locked ?? hovered : null;
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
      if (tutorial.phase === 'place' && revealTimer === null && attack && tutorialAttackAllowed()) {
        if (preview) {
          const { meta } = preview;
          for (const cell of meta.origins) tiles[cell.y * COLS + cell.x].classList.add('atk-origin');
          for (const cell of meta.flips) tiles[cell.y * COLS + cell.x].classList.add('atk-flip');
          for (const cell of meta.neutrals) tiles[cell.y * COLS + cell.x].classList.add('atk-neutral');
          for (const cell of meta.blocked) {
            if (rules.inBounds(cell.x, cell.y)) tiles[cell.y * COLS + cell.x].classList.add('atk-blocked');
          }
          targetTile.classList.add('atk-anchor');
        } else {
          // No target yet: preview the scripted step-5 attack so only the
          // script origin (G05) is highlighted, with its H05-J05 flip path
          // (design 4.2), instead of framing every player core.
          const scriptedMove = tutorial.step.player;
          const scriptedPreview = rules.inspectMove(game, 'player', {
            slot: scriptedMove.slot,
            rotation: scriptedMove.rotation,
            x: scriptedMove.x,
            y: scriptedMove.y,
            attack: true,
          });
          if (scriptedPreview && !scriptedPreview.error && scriptedPreview.meta) {
            for (const cell of scriptedPreview.meta.origins) tiles[cell.y * COLS + cell.x].classList.add('atk-origin');
            for (const cell of scriptedPreview.meta.flips) tiles[cell.y * COLS + cell.x].classList.add('atk-flip');
            for (const cell of scriptedPreview.meta.neutrals) tiles[cell.y * COLS + cell.x].classList.add('atk-neutral');
            for (const cell of scriptedPreview.meta.blocked) {
              if (rules.inBounds(cell.x, cell.y)) tiles[cell.y * COLS + cell.x].classList.add('atk-blocked');
            }
          }
        }
      }
      tutorialRenderPreview();
      // Non-target anchors show the ghost but never enable submit via preview;
      // submit validation is the tutorialConfirm exact-match check.
      if (keepTiles !== previewTiles) {
        for (const cell of keepTiles) cell.classList.remove('preview', 'preview-core', 'locked', 'invalid', 'attacking');
      }
      renderControls(preview);
      return;
    }
    for (const cell of previewTiles) {
      cell.classList.remove('preview', 'preview-core', 'locked', 'invalid', 'attacking');
    }
    previewTiles = [];
    for (const tile of tiles) tile.classList.remove(...ATk_CLASSES);
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
    // Attack overlays: static origin frames while aiming, per-cell state once
    // a target is hovered/locked. Never applied outside attack mode.
    if (canPlay() && attack) {
      if (preview) {
        const { meta } = preview;
        for (const cell of meta.origins) tiles[cell.y * COLS + cell.x].classList.add('atk-origin');
        for (const cell of meta.flips) tiles[cell.y * COLS + cell.x].classList.add('atk-flip');
        for (const cell of meta.neutrals) tiles[cell.y * COLS + cell.x].classList.add('atk-neutral');
        for (const cell of meta.blocked) {
          if (rules.inBounds(cell.x, cell.y)) tiles[cell.y * COLS + cell.x].classList.add('atk-blocked');
        }
        targetTile.classList.add('atk-anchor');
      } else {
        for (const [index, tile] of game.board.entries()) {
          if (tile.owner === 'player' && (tile.kind === 'core' || game.map.bridgeCells.has(index))) {
            tiles[index].classList.add('atk-origin');
          }
        }
      }
    }
    renderControls(preview);
  }

  function renderControls(preview) {
    if (tutorial.active) {
      tutorialRenderControls(preview);
      return;
    }
    const player = game.players.player;
    const card = player.hand[slot];
    const ready = canPlay() && Boolean(card);
    const bridgeMap = game.map.bridgeCells.size > 0;
    const attackOrigin = bridgeMap ? '己方特殊格或己方桥格' : '己方特殊格';
    setupButton.disabled = revealTimer !== null;
    rotateButton.disabled = !ready;
    passButton.disabled = !ready;
    // SP-short special stays clickable (explains itself via toast), so the
    // state is expressed with aria-disabled instead of native disabled.
    const spShort = ready && player.sp < card.cost;
    specialButton.disabled = !ready;
    specialButton.setAttribute('aria-disabled', spShort && !attack ? 'true' : 'false');
    specialButton.classList.toggle('is-locked', Boolean(card) && spShort && !attack);
    specialButton.setAttribute('aria-pressed', attack);
    specialLabel.textContent = card
      ? (spShort && !attack ? `特殊攻击 · 缺 ${card.cost - player.sp}` : `特殊攻击 · ${card.cost} SP`)
      : '特殊攻击';
    specialButton.title = card ? `消耗 ${card.cost} SP · 紧贴${attackOrigin}` : '';
    submitButton.disabled = !ready || !locked || !preview || Boolean(preview.error);
    submitButton.classList.toggle('attack', attack);
    submitButton.firstElementChild.textContent = attack ? '确认攻击' : '确认落子';

    let message = bridgeMap ? '点棋盘锁定落点。占下蓝框桥格，可从旁边发动特攻。' : '点棋盘选位置，再确认落子。';
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
      if (attack) {
        // Real numbers from the engine's meta, never UI-estimated.
        const origin = preview.meta.origins[0];
        message = `${positionName(locked)} · 将反涂 ${preview.meta.flips.length} 格 · 消耗 ${card.cost} SP · 起点 ${origin ? positionName(origin) : '无'}`;
      } else {
        message = `${positionName(locked)} · 可以落子`;
      }
      state = attack ? 'attack' : 'valid';
    } else if (attack) {
      message = `特攻：消耗 ${card.cost} SP。贴着${attackOrigin}落子，可覆盖对方墨格。`;
      state = 'attack';
    } else if (ready && !legality[slot] && !locked) {
      // Dimmed card selected with no locked target. Once locked, every move
      // is illegal so the locked branch above reports the concrete reason.
      message = `「${card.name}」现在没有合法落点。可以弃牌换 1 SP，或换一张牌。`;
    }
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = state;
    legend.classList.toggle('attack-mode', attack);
    updateMulliganButton();
    phase.classList.toggle('resolving', !canPlay() && !game.finished);
    phase.lastElementChild.textContent = game.finished ? '对局结束' : canPlay() ? '选择落点' : '揭晓中';
  }

  function renderLog() {
    const log = byId('turn-log');
    if (tutorial.active) {
      if (tutorial.phase === 'explain' && tutorial.lastReport) {
        const step = tutorial.step;
        const actions = tutorial.lastReport.plans.map(({ side, card, move, gained, captured }) => {
          const play = `${card.name}${move.attack ? '·特攻' : ''}`;
          const change = tutorial.lastTurnScoreChange ? tutorial.lastTurnScoreChange[side] : 0;
          const score = `占格 ${change > 0 ? '+' : ''}${change}`;
          const capture = captured ? ` · 反涂 ${captured} 格` : '';
          const cost = move.attack ? ` · 消耗 ${card.cost} SP` : '';
          const energy = gained ? ` · 获得 ${gained} SP` : '';
          return `<span class="turn-action ${side}-note">${side === 'player' ? '你' : '电脑'} ${play} · ${score}${capture}${cost}${energy}</span>`;
        });
        const clash = tutorial.lastReport.collisions ? `　撞格 ${tutorial.lastReport.collisions}` : '';
        const blocked = tutorial.lastReport.blocked ? `（封锁 ${tutorial.lastReport.blocked}）` : '';
        log.innerHTML = `<b>第 ${tutorial.lastReport.round} 回合</b>${clash}${blocked}${actions.join('')}<span class="turn-action">${step.explain}</span>`;
      } else {
        log.textContent = tutorial.step.instruction;
      }
      return;
    }
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
    if (tutorial.active && index !== tutorialScriptedCard()) {
      tutorialHint(tutorial.step.hint.card);
      return;
    }
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
    if (tutorial.active) {
      if (tutorial.phase !== 'place') return;
      if (!tutorialRotationAllowed()) {
        tutorialHint('方向已由本步固定。');
        return;
      }
      rotation = (rotation + direction + 4) % 4;
      renderHand();
      renderPreview();
      const scripted = tutorial.step.player.rotation;
      if (rotation === scripted) {
        tutorialRenderStatus('已转好。', 'valid');
      } else {
        tutorialRenderStatus(tutorial.step.hint.rotation ?? '再点「旋转」调整方向。', '');
      }
      return;
    }
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

  // Player's one-time opening mulligan: swap hand for the next 4 pile
  // cards, then recompute everything that depends on the hand.
  function takeMulligan() {
    if (tutorial.active) return; // fixed hand: no mulligan in tutorial
    if (!canPlay() || battleView.hidden || trial || game.mulliganUsed.player) return;
    if (!rules.mulligan(game, 'player')) return;
    resetPlacement();
    legality = computeLegality();
    openingTarget = suggestOpeningTarget();
    hideActionToast();
    renderHand();
    renderNextDraw();
    renderPreview();
    // Set after the renders so renderControls doesn't overwrite it.
    status.textContent = '已换 4 张手牌，本局不能再换';
    status.dataset.state = 'valid';
    updateMulliganButton();
  }

  function updateMulliganButton() {
    const show = !trial && canPlay() && game.round === 1 && !game.mulliganUsed.player;
    mulliganButton.hidden = !show;
  }

  function toggleSpecial() {
    if (!canPlay() || battleView.hidden || rulesDialog.open) return;
    if (tutorial.active) {
      if (tutorial.phase !== 'place') return;
      if (!tutorialAttackAllowed()) {
        tutorialHint('特攻后面再学，本步先普通落子。');
        return;
      }
      attack = !attack;
      renderHand();
      renderPreview();
      const scripted = tutorial.step.player;
      if (attack) {
        tutorialRenderStatus(`特攻要贴着己方特殊格 G05。落到 ${tutData.positionName({ x: scripted.x, y: scripted.y })}。`, 'attack');
      } else {
        tutorialRenderStatus('已取消特攻，可再点亮。', '');
      }
      return;
    }
    const player = game.players.player;
    const card = player.hand[slot];
    if (!card) return;
    if (player.sp < card.cost) {
      showActionToast(`特攻需要 ${card.cost} SP，你目前 ${player.sp}。围满特殊格周围 8 格，或弃牌，各得 1 SP。`);
      return;
    }
    hideActionToast();
    attack = !attack;
    renderPreview();
  }

  function showResult() {
    if (tutorial.active) return; // tutorial ending never opens the dialog
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
    if (tutorial.active) {
      // Tutorial: confirm passes through the exact-match controller.
      tutorialConfirm();
      return;
    }
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
      legality = computeLegality();
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

  const DRAG_THRESHOLD_PX = 8;
  const DRAG_LIFT_PX = 56;

  // pointerdown on a hand card: remember press state; the card's click
  // handler still owns tap selection. Only touches/pens can become drags.
  function beginDragPress(event, slotIndex) {
    if (!drag.enabled || event.pointerType === 'mouse') return;
    if (tutorial.active) return; // drag disabled in tutorial (design A3)
    if (!canPlay() || battleView.hidden || rulesDialog.open) return;
    if (!game.players.player.hand[slotIndex]) return;
    drag.pointerId = event.pointerId;
    drag.slot = slotIndex;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.active = false;
    // Snapshot the whole pre-drag selection unconditionally: cancel must
    // bring back not just the locked tile but the exact rotation/attack of
    // the selected card, even when the dragged card is a different one.
    drag.prevSlot = slot;
    drag.prevRotation = rotation;
    drag.prevAttack = attack;
    drag.prevLocked = locked;
    drag.dragRotation = slotIndex === slot ? rotation : 0;
    // Follow the pointer even before the threshold is crossed so the drag
    // decision itself is made on pointermove, not on a re-dispatched event.
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }

  function draggingCard() {
    return drag.slot !== null ? cards[drag.slot] : null;
  }

  function targetFromPoint(clientX, clientY) {
    const rect = board.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right
      || clientY < rect.top || clientY >= rect.bottom) return null;
    const style = getComputedStyle(board);
    const gap = parseFloat(style.columnGap) || 0;
    const cell = (rect.width - gap * (COLS - 1)) / COLS;
    const rowHeight = (rect.height - gap * (ROWS - 1)) / ROWS;
    const x = Math.floor((clientX - rect.left) / (cell + gap));
    const y = Math.floor((clientY - rect.top) / (rowHeight + gap));
    return rules.inBounds(x, y) ? { x, y } : null;
  }

  function moveGhost(clientX, clientY) {
    dragGhost.style.left = `${clientX}px`;
    dragGhost.style.top = `${clientY - DRAG_LIFT_PX}px`;
  }

  function onDragMove(event) {
    if (event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Crossed the threshold: enter dragging and select the pressed card.
      drag.active = true;
      selectCard(drag.slot);
      const card = draggingCard();
      if (!card) { cancelDrag(); return; }
      card.classList.add('dragging');
      const player = game.players.player;
      const pressed = player.hand[drag.slot];
      dragGhost.innerHTML = cardMarkup(pressed, drag.dragRotation, '');
      dragGhost.hidden = false;
      locked = null;
      hovered = null;
    }
    event.preventDefault();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      moveGhost(drag.lastX, drag.lastY);
      const target = targetFromPoint(drag.lastX, drag.lastY - DRAG_LIFT_PX);
      const changed = target?.x !== hovered?.x || target?.y !== hovered?.y;
      if (changed) {
        hovered = target;
        renderPreview();
      }
    });
  }

  function endDragCommon() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    if (drag.frame) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }
    dragGhost.hidden = true;
    const card = draggingCard();
    if (card) card.classList.remove('dragging');
    drag.pointerId = null;
    drag.slot = null;
    drag.active = false;
  }

  function onDragEnd(event) {
    if (event.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    endDragCommon();
    if (!wasActive) return; // plain tap: card's click handler proceeds
    // Swallow the click that follows a real drag so it can't re-select.
    drag.pendingClick = true;
    setTimeout(() => { drag.pendingClick = false; }, 0);
    const target = targetFromPoint(event.clientX, event.clientY - DRAG_LIFT_PX);
    if (target) {
      setTarget(target);
    } else {
      // Released off the board: restore the whole pre-drag selection.
      restoreDragSnapshot();
    }
  }

  function onDragCancel(event) {
    if (event.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    endDragCommon();
    if (!wasActive) return;
    drag.pendingClick = true;
    setTimeout(() => { drag.pendingClick = false; }, 0);
    restoreDragSnapshot();
  }

  // Cancel path: bring back the exact pre-drag selection — the previously
  // selected card, its rotation/attack, the locked tile and the preview.
  // Restore every value first, then render once, so the card face and
  // preview reflect the restored rotation rather than the stale one.
  function restoreDragSnapshot() {
    if (drag.prevSlot === null) return;
    slot = drag.prevSlot;
    rotation = drag.prevRotation;
    attack = drag.prevAttack;
    locked = drag.prevLocked;
    hovered = null;
    renderHand();
    renderPreview();
  }

  function cancelDrag() {
    if (drag.pointerId === null) return;
    endDragCommon();
    restoreDragSnapshot();
  }

  function setTarget(target) {
    locked = target;
    hovered = null;
    board.focus({ preventScroll: true });
    if (tutorial.active && tutorial.phase === 'place') {
      const scripted = tutorial.step.player;
      const onTarget = locked.x === scripted.x && locked.y === scripted.y;
      renderPreview();
      tutorialRenderStatus(onTarget
        ? `${positionName(locked)} · 可以确认`
        : tutorial.step.hint.target, onTarget ? 'valid' : 'invalid');
      return;
    }
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
  window.addEventListener('blur', () => {
    if (drag.active || drag.pointerId !== null) cancelDrag();
  });

  window.addEventListener('keydown', (event) => {
    if (battleView.hidden || !canPlay() || rulesDialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (tutorial.active) {
      const key = event.key.toLowerCase();
      if (/^[1-4]$/.test(key)) {
        const index = Number(key) - 1;
        if (index === tutorialScriptedCard()) selectCard(index);
        else tutorialHint(tutorial.step.hint.card);
      } else if (key === 'r') {
        rotateCard(event.shiftKey ? -1 : 1);
      } else if (key === 'e') {
        event.preventDefault();
        if (!event.repeat) toggleSpecial();
      } else if (arrows[event.key]) {
        event.preventDefault();
        const scripted = tutorial.step.player;
        const target = locked ?? { x: scripted.x, y: scripted.y };
        const x = target.x + arrows[event.key][0];
        const y = target.y + arrows[event.key][1];
        if (rules.inBounds(x, y)) setTarget({ x, y });
      } else if (key === 'enter') {
        if (tutorial.phase === 'place' && !submitButton.disabled && tutorialNextButton.hidden) {
          event.preventDefault();
          tutorialConfirm();
        } else if (tutorial.phase === 'explain' && !tutorialNextButton.disabled) {
          event.preventDefault();
          tutorialNext();
        }
      }
      return;
    }
    const key = event.key.toLowerCase();
    const step = arrows[event.key];
    if (/^[1-4]$/.test(key)) {
      selectCard(Number(key) - 1);
    } else if (key === 'r') {
      rotateCard(event.shiftKey ? -1 : 1);
    } else if (key === 'e') {
      event.preventDefault();
      if (!event.repeat) toggleSpecial();
    } else if (key === 'escape') {
      if (drag.active) cancelDrag();
      else if (locked) {
        locked = null;
        renderPreview();
      }
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
  mulliganButton.addEventListener('click', takeMulligan);
  submitButton.addEventListener('click', () => {
    if (locked) play(makeMove(locked));
  });
  byId('show-rules').addEventListener('click', () => {
    hideActionToast();
    resetRulesTutorialConfirm();
    rulesDialog.showModal();
  });
  rulesDialog.addEventListener('close', () => {
    resetRulesTutorialConfirm();
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
    rulesTutorialButton.hidden = true; // no tutorial in trial mode
    replayButton.classList.replace('quiet', 'primary');
    trialReplay.addEventListener('click', () => startGame(activeConfig));
    startGame({ mapId: 'bridge', difficultyId: 'standard', bridgeOrigins: trial.bridgeOrigins });
  } else {
    setupButton.addEventListener('click', showSetup);
    byId('result-setup').addEventListener('click', showSetup);
    tutorialSkipButton.addEventListener('click', tutorialSkip);
    tutorialNextButton.addEventListener('click', tutorialNext);
    // Rules-dialog "watch the tutorial": inline confirm when a match is
    // running (design 1.4/5.3 — no window.confirm). Replay ends into the
    // current loadout.
    const rulesMidMatch = () => game && !game.finished && !tutorial.active;
    rulesTutorialButton.addEventListener('click', () => {
      if (!rulesMidMatch()) {
        rulesDialog.close();
        startTutorial({ replay: true });
        return;
      }
      rulesTutorialButton.hidden = true;
      rulesTutorialConfirm.hidden = false;
      rulesTutorialStart.focus();
    });
    rulesTutorialCancel.addEventListener('click', () => {
      resetRulesTutorialConfirm();
      rulesTutorialButton.focus();
    });
    rulesTutorialStart.addEventListener('click', () => {
      startTutorial({ replay: true });
    });
    // Rules dialog close resets the inline confirm so it never survives
    // into the next open (open is covered by the show-rules click above).
    // Setup page "再看教学": same inline-confirm pattern; starting here
    // abandons the running match (not scored) per design 5.3.
    replayTutorialButton.addEventListener('click', () => {
      if (!rulesMidMatch()) {
        startTutorial({ replay: true });
        return;
      }
      replayTutorialButton.hidden = true;
      setupTutorialConfirm.hidden = false;
      setupTutorialStart.focus();
    });
    setupTutorialCancel.addEventListener('click', () => {
      resetSetupTutorialConfirm();
      replayTutorialButton.focus();
    });
    setupTutorialStart.addEventListener('click', () => {
      startTutorial({ replay: true });
    });
    if (!maybeStartTutorialOnBoot()) {
      setup.show(false); // normal path: show setup on load
    }
  }
})();
