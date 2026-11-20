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
  const mulliganDialog = byId('mulligan-dialog');
  // Deck viewer (v1.3.3): count-as-button entry plus the peek dialog.
  const deckPeekButton = byId('deck-peek');
  const deckPeekDialog = byId('deck-peek-dialog');
  const mulliganKeepButton = byId('mulligan-keep');
  const mulliganRedrawButton = byId('mulligan-redraw');
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
    // v1.2 substeps: each scenario splits "one place + confirm" into single
    // actions (design 教学关-v1.2 §2). Data stays in tutorial.js; the
    // substep sequence belongs to this controller.
    substeps: null,
    substep: 0, // index into substeps
    arrowBase: null, // last keyboard-walk cell in drag/place substeps
    errors: 0,
  };
  // Substep sequences per scenario id. select/drag teach full placement in
  // step 01; 02 teaches rotation first; 03/04/06 preset rotation; 05 adds
  // the special toggle before placing.
  const TUTORIAL_SUBSTEPS = {
    '01': ['select', 'drag', 'rotate', 'confirm'],
    '02': ['rotate', 'place', 'confirm'],
    '03': ['place', 'confirm'],
    '04': ['place', 'confirm'],
    '05': ['special', 'place', 'confirm'],
    '06': ['place', 'confirm'],
  };
  const TUTORIAL_SUBSTEP_NAMES = {
    select: '选择卡牌',
    drag: '拖到落点',
    place: '选择落点',
    rotate: '旋转方向',
    special: '特殊攻击',
    confirm: '确认落子',
    reveal: '同时揭晓',
    explain: '讲解',
  };
  let sessionTutorialDone = false;
  let skipResetTimer = null;
  // Opening mulligan prompt (v1.2): fires once per formal startGame after
  // the battle view renders; module-level so replays can't stack dialogs.
  let mulliganPrompted = false;
  // Drag state: press -> (moved >= threshold) dragging -> drop/cancel.
  const drag = {
    enabled: readDragFlag(),
    pointerId: null,
    slot: null,
    // Board drag (v1.2 B): re-drag a locked preview from the board itself.
    // Hand drags and board drags share the pointermove/up/cancel plumbing;
    // `board` picks the branch at threshold and at release.
    board: false,
    startX: 0,
    startY: 0,
    active: false,
    // Snapshot of the pre-drag selection so cancel can restore it exactly.
    prevSlot: null,
    prevRotation: 0,
    prevAttack: false,
    prevLocked: null,
    // Board drag: the locked target before the press, so cancel restores it.
    boardPrevLocked: null,
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

  // =====================================================================
  // v1.3-B1 motion (design 全屏与表现力-v1.3 §4): light one-shot CSS
  // classes, transform/opacity only, never blocking input. Under
  // prefers-reduced-motion nothing is animated and no class is added.
  // =====================================================================
  const motionTimers = {};
  let lastNextDrawKey = null; // next-draw flips only after a real card change
  // v1.3-B2: previous score/SP snapshot; null means "no baseline yet" so the
  // very first render of a match (or tutorial step) never bumps.
  let lastScoreState = null; // { player, cpu }
  let lastSpState = null; // { player, cpu }

  function motionEnabled() {
    try {
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false; // matchMedia unavailable: stay static
    }
  }

  // One-shot animation class: restart-safe (remove + reflow + add) and
  // self-cleaning, so repeated triggers can't stack stale classes/timers.
  // `key` defaults to className; pass a unique one when the same class goes
  // to several elements (player/cpu score/sp) so their timers can't evict
  // each other.
  function playMotionOnce(element, className, duration, key = className) {
    if (!motionEnabled() || !element) return;
    element.classList.remove(className);
    void element.offsetWidth; // force reflow: a repeat add re-runs the animation
    element.classList.add(className);
    clearTimeout(motionTimers[key]);
    motionTimers[key] = setTimeout(() => {
      delete motionTimers[key];
      element.classList.remove(className);
    }, duration);
  }

  // Drop every motion class, timer and pending flag (view switches, results,
  // new games) so nothing leaks across surfaces. The per-surface removals
  // mirror the classes playMotionOnce can add; B1's dealing/shuffling/flip/
  // view-enter stay in the same sweep (nothing may survive a view switch).
  function clearMotion() {
    for (const className of Object.keys(motionTimers)) {
      clearTimeout(motionTimers[className]);
      delete motionTimers[className];
    }
    battleView.classList.remove('view-enter');
    hand.classList.remove('dealing');
    const deckInfo = document.querySelector('.hand-deck');
    if (deckInfo) deckInfo.classList.remove('shuffling');
    byId('next-draw').classList.remove('flip');
    board.classList.remove('revealing');
    byId('player-score').classList.remove('score-bump');
    byId('cpu-score').classList.remove('score-bump');
    byId('player-sp').classList.remove('sp-bump');
    byId('cpu-sp').classList.remove('sp-bump');
    byId('turf-bar').classList.remove('turf-bump');
    document.querySelector('.result-scores').classList.remove('result-bump');
    // lastScoreState/lastSpState deliberately survive: startGame calls
    // renderGame() before clearMotion(), so nulling here would erase the
    // opening baseline and mute the first settled turn. Explicit resets live
    // in startGame/showTutorialStep (before their own renderGame).
  }

  // Opening deal: hand cards fly in from the deck corner, deck icon shuffles.
  // Never called for tutorial steps (showTutorialStep owns that flow).
  function playOpeningMotion() {
    if (!motionEnabled() || tutorial.active || battleView.hidden) return;
    playMotionOnce(hand, 'dealing', 700);
    const deckInfo = document.querySelector('.hand-deck');
    if (deckInfo && !deckInfo.hidden) playMotionOnce(deckInfo, 'shuffling', 700);
  }

  // Delayed mulligan prompt (v1.3.1): fires after the opening deal finishes.
  // Cleared in startGame (restart) and showResult (dialog never after end);
  // maybePromptMulligan itself re-checks round/finished/hidden state so a
  // stale timer can never pop the dialog mid-turn or on a dead view.
  // v1.3.3: the 700ms clock starts only after the deal's first rendered
  // frame (double rAF) — slow phones painted the board later than the old
  // setTimeout, so the dialog covered the whole deal animation. Both the
  // pending rAF and the timer are torn down together everywhere.
  let mulliganPromptTimer = null;
  let mulliganPromptRaf = null;

  function clearMulliganPromptArming() {
    if (mulliganPromptRaf !== null) {
      cancelAnimationFrame(mulliganPromptRaf);
      mulliganPromptRaf = null;
    }
    if (mulliganPromptTimer !== null) {
      clearTimeout(mulliganPromptTimer);
      mulliganPromptTimer = null;
    }
  }

  // Arm the deal->prompt chain. Reduced motion skips the rAF wait entirely:
  // there is no deal to watch, so the prompt stays near-instant (0ms).
  function armMulliganPrompt() {
    clearMulliganPromptArming();
    if (!motionEnabled()) {
      mulliganPromptTimer = setTimeout(maybePromptMulligan, 0);
      return;
    }
    mulliganPromptRaf = requestAnimationFrame(() => {
      mulliganPromptRaf = requestAnimationFrame(() => {
        mulliganPromptRaf = null;
        mulliganPromptTimer = setTimeout(maybePromptMulligan, 700);
      });
    });
  }

  function showBattle() {
    setupView.hidden = true;
    battleView.hidden = false;
    setupButton.hidden = Boolean(trial) || tutorial.active;
    window.scrollTo(0, 0);
    board.focus({ preventScroll: true });
  }

  function setupHasResume() {
    // A formal match in progress can be resumed; a finished or cleared one
    // cannot. Tutorial boards never offer 返回对局 (they end at setup).
    return Boolean(game && !game.finished && !tutorial.active);
  }

  function showSetup() {
    clearMotion(); // no motion class/timer leaks into setup
    hideActionToast();
    if (resultDialog.open) resultDialog.close();
    closeMulliganDialog();
    closeDeckPeek();
    // No stale deal->prompt arming may pop the dialog over the setup view.
    clearMulliganPromptArming();
    resetSetupTutorialConfirm();
    battleView.hidden = true;
    setupButton.hidden = true;
    // v1.2: 「返回对局」 only for a running formal match. After the
    // tutorial game is cleared, so the setup view must never offer resume.
    setup.show(setupHasResume());
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

  function tutorialSubstep() {
    return tutorial.substeps ? tutorial.substeps[tutorial.substep] : null;
  }

  // Substeps that let the scripted card land on the board (drag or tap).
  function tutorialBoardSubstep() {
    const current = tutorialSubstep();
    return current === 'drag' || current === 'place';
  }

  // Advance to a named substep (or the next one by default) and refresh all
  // dependent UI. Used by select/drag/rotate/special transitions; confirm
  // advances to the reveal via tutorialConfirm.
  function advanceTutorialSubstep(next) {
    const substeps = tutorial.substeps ?? [];
    const index = next
      ? substeps.indexOf(next)
      : tutorial.substep + 1;
    if (index >= 0 && index < substeps.length) tutorial.substep = index;
    renderHand();
    renderPreview();
    tutorialRenderChrome();
    tutorialRenderSubstepStatus('');
    tutorialScheduleMask();
  }

  function tutorialTarget() {
    return { x: tutorial.step.player.x, y: tutorial.step.player.y };
  }

  function tutorialScriptedCard() {
    return tutorial.step.player.slot;
  }

  function tutorialRotationAllowed() {
    return tutorialSubstep() === 'rotate';
  }

  function tutorialAttackAllowed() {
    return tutorialSubstep() === 'special';
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
    tutorial.substep = 0;
    tutorial.errors = 0;
    document.body.classList.add('tutorial-mode');
    setupView.hidden = true;
    // A replay start must never land under a stale result/rules overlay
    // (e.g. entered from a finished match while the result was pending).
    hideActionToast();
    resultPending = false;
    if (resultDialog.open) resultDialog.close();
    closeMulliganDialog();
    closeDeckPeek();
    clearMulliganPromptArming();
    if (rulesDialog.open) rulesDialog.close();
    resetRulesTutorialConfirm();
    resetSetupTutorialConfirm();
    showTutorialStep();
  }

  // Load one step: fresh game, scripted card preselected (except step 01's
  // select substep), rotation preset (except steps 01/02, which teach it).
  function showTutorialStep() {
    const step = tutData.TUTORIAL_STEPS[tutorial.index];
    tutorial.step = step;
    tutorial.phase = 'place';
    tutorial.errors = 0;
    tutorial.lastReport = null; // fresh log per step
    // v1.2: per-scenario substep machine; always start from the first one.
    tutorial.substeps = TUTORIAL_SUBSTEPS[step.id];
    tutorial.substep = 0;
    tutorial.arrowBase = null;
    // New step: disarm any two-stage skip so label and state stay in sync.
    clearTimeout(skipResetTimer);
    skipResetTimer = null;
    game = tutData.createTutorialGame(step);
    cpuMove = { ...step.cpu };
    clearMotion(); // tutorial steps never deal/shuffle/flip (v1.3-B1)
    lastNextDrawKey = null; // tutorial hides the chip; reset for a later formal game
    // New step, new baseline: the step's opening render must not bump even
    // though the previous step's score/SP state differs (v1.3-B2).
    lastScoreState = null;
    lastSpState = null;
    // Step 01 starts with no card selected (select substep teaches picking);
    // step 02 keeps the scripted card selected with rotation 0 (rotate twice
    // to r2); 03/04/05/06 preset the scripted rotation.
    slot = step.id === '01' ? null : step.player.slot;
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
    tutorialRenderSubstepStatus('');
    tutorialScheduleMask();
  }

  // Short per-substep instruction. `extra` is appended (e.g. an error hint).
  function tutorialSubstepHint(step, current) {
    if (current === 'select') {
      return `点选 ${step.player.slot + 1} 号「${game.players.player.hand[step.player.slot].name}」。`;
    }
    if (current === 'drag') {
      return `按住卡牌拖到高亮格 ${positionName(tutorialTarget())}。`;
    }
    if (current === 'rotate') {
      return step.hint.rotation ?? '点「旋转」调整方向。';
    }
    if (current === 'special') {
      return `点「特殊攻击」，把 ${step.player.slot + 1} 号「${game.players.player.hand[step.player.slot].name}」落到 ${positionName(tutorialTarget())}。`;
    }
    if (current === 'place') {
      return `点或拖到高亮格 ${positionName(tutorialTarget())}。`;
    }
    return step.player.attack ? '点「确认攻击」。' : '点「确认落子」。';
  }

  function tutorialRenderSubstepStatus(extra) {
    const step = tutorial.step;
    const current = tutorialSubstep();
    if (!current) {
      // Reveal/explain windows keep their own status copy.
      tutorialRenderStatus(extra ?? '', extra ? 'invalid' : '');
      return;
    }
    // Step 05's confirm reads 确认攻击 to match the button (design §2).
    const name = current === 'confirm' && step.player.attack ? '确认攻击' : TUTORIAL_SUBSTEP_NAMES[current] ?? '';
    const base = `${name}：${tutorialSubstepHint(step, current)}`;
    tutorialRenderStatus(extra ? `${extra} ${base}` : base, extra ? 'invalid' : '');
  }

  // Confirm the scripted move: only an exact {slot, rotation, x, y, attack}
  // match advances, and only from the confirm substep. Wrong choices get a
  // short hint, never a silent block.
  function tutorialConfirm() {
    if (tutorial.phase !== 'place' || revealTimer !== null) return;
    if (tutorialSubstep() !== 'confirm') return; // substep guard
    const step = tutorial.step;
    const scripted = step.player;
    if (slot !== scripted.slot) {
      tutorialHint(step.hint.card);
      return;
    }
    if (rotation !== scripted.rotation) {
      tutorialHint(step.id === '01' || step.id === '02'
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
    tutorial.substep = tutorial.substeps.length; // past confirm: reveal/explain
    tutorialRenderStatus('双方已锁牌，正在结算。', '');
    renderHand();
    renderPreview();
    renderControls(null);
    // v1.3-B2: same reveal pulse as the formal play() (motionEnabled gates it).
    playMotionOnce(board, 'revealing', 380, 'board-reveal');
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
      // Button label is 「完成教学」 (tutorialRenderControls), so the copy
      // must point at the same word (QA P3 #1).
      tutorialRenderStatus(step.id === '06'
        ? '终局 51:50，你赢 1 格；点「完成教学」。'
        : '本步结算如上。', 'valid');
      // Step 6 shows the final 51:50; the formal result dialog is skipped.
    }, 240);
  }

  function tutorialHint(message) {
    tutorial.errors += 1;
    const suffix = tutorial.errors >= 3 ? '（也可以「跳过」）' : '';
    const current = tutorialSubstep();
    if (!current) {
      tutorialRenderStatus(`${message}${suffix}`, 'invalid');
      return;
    }
    tutorialRenderSubstepStatus(`${message}${suffix}`);
  }

  // 「下一步」 / 「完成教学」 after the reveal.
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
    game = null; // clear the tutorial board so setup can't resume it
    showSetup();
    showActionToast('教学完成，选择地图开始对战');
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
    game = null; // clear the tutorial board so setup can't resume it
    showSetup();
    showActionToast('已跳过教学，选择地图开始对战');
  }

  function tutorialCleanup() {
    tutorial.active = false;
    tutorial.step = null;
    tutorial.substeps = null;
    tutorial.substep = 0;
    tutorial.arrowBase = null;
    tutorial.errors = 0;
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
    // v1.2 §3: mask and coach must never survive into setup or a formal
    // match; also drop any queued mask update.
    tutorialHideMask();
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
    const current = tutorialSubstep();
    // Step 05's confirm chip reads 确认攻击 to match the button and status.
    const chipName = current === 'confirm' && tutorial.step.player.attack
      ? '确认攻击'
      : TUTORIAL_SUBSTEP_NAMES[current] ?? '选择落点';
    phase.lastElementChild.textContent = tutorial.phase === 'place'
      ? chipName
      : tutorial.phase === 'reveal' ? '同时揭晓' : '讲解';
    phase.classList.toggle('resolving', tutorial.phase === 'reveal');
  }

  // renderControls hook: only the current substep's controls are visible
  // (design 教学关-v1.2 §2 — one action at a time). Status copy stays
  // owned by the substep machine; renderControls never overwrites it here.
  function tutorialRenderControls(preview) {
    // Step 05 attack mode switches the board legend to the A4 attack key
    // (起点/反涂/不能落); other states restore the normal placement legend
    // (showTutorialStep also clears it on entry).
    legend.classList.toggle('attack-mode', attack);
    // Mask/coach follow every controls pass: explain/reveal hide them here,
    // place phases re-aim them at the current substep's targets (v1.2 §3).
    tutorialScheduleMask();
    const step = tutorial.step;
    const scripted = step.player;
    const current = tutorialSubstep();
    const ready = tutorial.phase === 'place' && revealTimer === null;
    passButton.hidden = true;
    mulliganButton.hidden = true;
    if (tutorial.phase === 'explain') {
      submitButton.hidden = true;
      tutorialNextButton.hidden = false;
      // v1.2: the tutorial ends back at setup, so the final label is
      // 「完成教学」 (design 教学关-v1.2 §2/§5), overriding the v1.1 data's
      // nextLabel — no formal match starts from the tutorial anymore.
      const label = step.id === '06' ? '完成教学' : step.nextLabel;
      tutorialNextButton.textContent = label;
      tutorialNextButton.setAttribute('aria-label', label);
      tutorialNextButton.disabled = revealTimer !== null;
      // Explain window: every action control hides (design §2).
      rotateButton.hidden = true;
      specialButton.hidden = true;
      setupButton.disabled = revealTimer !== null;
      return;
    }
    tutorialNextButton.hidden = true;
    if (tutorial.phase !== 'place' || revealTimer !== null) {
      // Reveal (240ms): hide everything, status already set elsewhere.
      submitButton.hidden = true;
      rotateButton.hidden = true;
      specialButton.hidden = true;
      setupButton.disabled = true;
      return;
    }
    setupButton.disabled = false;
    // Rotate: only in the rotate substep (01/02).
    rotateButton.hidden = current !== 'rotate';
    specialButton.hidden = current !== 'special';
    submitButton.hidden = current !== 'confirm';
    if (current === 'rotate') {
      const scriptedRotation = scripted.rotation;
      const rotated = rotation === scriptedRotation;
      rotateButton.disabled = rotated;
      rotateLabel.textContent = rotated ? '已转好' : '旋转';
      rotateButton.title = rotated ? '已转好' : '';
    }
    if (current === 'special') {
      // The formal is-locked/aria-disabled state must not leak into steps.
      specialButton.disabled = false;
      specialButton.classList.remove('is-locked');
      specialButton.setAttribute('aria-disabled', 'false');
      const player = game.players.player;
      const card = player.hand[scripted.slot];
      specialLabel.textContent = card ? `特殊攻击 · ${card.cost} SP` : '特殊攻击';
      specialButton.setAttribute('aria-pressed', attack);
    }
    if (current === 'confirm') {
      submitButton.classList.toggle('attack', attack);
      submitButton.firstElementChild.textContent = attack ? '确认攻击' : '确认落子';
      submitButton.setAttribute('aria-label', attack ? '确认攻击' : '确认落子');
      // Confirm stays clickable so mismatches get a hint from
      // tutorialConfirm's exact-match checks, never a silent block.
      submitButton.disabled = false;
    }
  }

  // renderPreview hook: highlight the scripted anchor in drag/place/confirm,
  // in step 02's rotate (target visible before anything is locked), and in a
  // rotate substep with a locked anchor (01: keep D05 lit while turning).
  // select/special show no landing hint (design 教学关-v1.2 §2).
  function tutorialRenderPreview() {
    for (const tile of tiles) tile.classList.remove('tutorial-target');
    if (tutorial.phase !== 'place') return;
    const current = tutorialSubstep();
    const showTarget = current === 'drag' || current === 'place' || current === 'confirm'
      || (current === 'rotate' && (tutorial.step.id === '02' || locked));
    if (!showTarget) return;
    const anchor = tutorialTarget();
    const anchorTile = tiles[anchor.y * COLS + anchor.x];
    anchorTile.classList.add('tutorial-target');
    // Anchor tile class changed -> mask preview holes need the new rect set.
    tutorialScheduleMask();
  }

  // =====================================================================
  // Focus mask + coach (v1.2 §3): a dimming SVG with cut-out holes over the
  // current substep's targets plus the placement/attack preview cells.
  // Pure display: pointer-events none everywhere, targets stay tappable,
  // the topbar stays holed so 跳过/玩法 keep working. Geometry lives in
  // element attributes (viewBox + rects), never CSS percentages.
  // =====================================================================

  const tutorialMaskEl = byId('tutorial-mask');
  const tutorialMaskSvg = byId('tutorial-mask-svg');
  const tutorialMaskBase = byId('tutorial-mask-base');
  const tutorialMaskShade = byId('tutorial-mask-shade');
  const tutorialMaskHoles = byId('tutorial-mask-holes');
  const tutorialMaskOutlines = byId('tutorial-mask-outlines');
  const tutorialCoachEl = byId('tutorial-coach');
  const tutorialCoachText = byId('tutorial-coach-text');
  const tutorialTopbar = document.querySelector('.topbar');
  let tutorialMaskFrame = null;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function tutorialSvgRect(x, y, width, height) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    return rect;
  }

  function tutorialVisibleRect(element) {
    const rect = element.getBoundingClientRect();
    // Zero-size or detached elements would punch invisible or garbage holes.
    if (rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  // Clamp a viewport-space rect so out-of-view targets don't extend the mask
  // beyond the SVG's viewBox.
  function tutorialClampRect({ x, y, width, height }, view) {
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(view.width, x + width);
    const bottom = Math.min(view.height, y + height);
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  // The current substep's main targets as viewport rects: element + expand
  // in px. Empty for explain/reveal (design §3: no mask over the log).
  function tutorialMaskTargets() {
    if (!tutorial.active || tutorial.phase !== 'place') return [];
    const current = tutorialSubstep();
    const anchor = tutorialTarget();
    const anchorTile = tiles[anchor.y * COLS + anchor.x];
    const targets = [];
    const push = (element) => {
      targets.push({ element, expand: 6 });
    };
    // Scripted card: a mask target in every place substep (design §3), so
    // rotate/special/confirm keep it lit too instead of dimming under the
    // shade. Pushed once here; the per-substep pushes below never re-add it.
    push(cards[tutorialScriptedCard()]);
    // Target tile: drag/place/confirm always; rotate only when it should be
    // lit (01 after the anchor locked, 02 from the start — design §2).
    const showAnchorTile = current === 'drag' || current === 'place' || current === 'confirm'
      || (current === 'rotate' && (tutorial.step.id === '02' || Boolean(locked)));
    if (showAnchorTile) push(anchorTile);
    if (current === 'rotate') push(rotateButton);
    if (current === 'special') push(specialButton);
    if (current === 'confirm') push(submitButton);
    return targets;
  }

  function tutorialUpdateMask() {
    tutorialMaskFrame = null;
    const current = tutorial.active ? tutorialSubstep() : null;
    const visible = tutorial.active && tutorial.phase === 'place' && Boolean(current);
    const targets = tutorialMaskTargets();
    if (!visible || targets.length === 0) {
      tutorialMaskEl.hidden = true;
      tutorialCoachEl.hidden = true;
      return;
    }
    const view = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    tutorialMaskSvg.setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
    for (const rect of [tutorialMaskBase, tutorialMaskShade]) {
      rect.setAttribute('x', '0');
      rect.setAttribute('y', '0');
      rect.setAttribute('width', String(view.width));
      rect.setAttribute('height', String(view.height));
    }
    // Holes: topbar (skip/rules stay clear and tappable), each target with a
    // 6px halo, then the live placement/attack preview cells (shape and flip
    // path must not be dimmed; design §3 + coordinator addendum). Preview
    // cells punch holes only — outlines stay on the main targets.
    const holes = [];
    const outlines = [];
    const seen = new Set();
    const addHole = ({ x, y, width, height }) => {
      const rounded = `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`;
      if (seen.has(rounded)) return;
      seen.add(rounded);
      holes.push({ x, y, width, height });
    };
    if (tutorialTopbar) {
      const bar = tutorialVisibleRect(tutorialTopbar);
      if (bar) addHole(bar, 'topbar');
    }
    for (const { element, expand } of targets) {
      const rect = tutorialVisibleRect(element);
      if (!rect) continue;
      // Hole halo = 6px out; gold outline = 5px out (design §3) — measured
      // from the raw target rect, so the ring sits just inside the hole.
      const clamped = tutorialClampRect({
        x: rect.x - expand,
        y: rect.y - expand,
        width: rect.width + expand * 2,
        height: rect.height + expand * 2,
      }, view);
      if (!clamped) continue;
      addHole(clamped, 'target');
      const ring = tutorialClampRect({
        x: rect.x - 5,
        y: rect.y - 5,
        width: rect.width + 10,
        height: rect.height + 10,
      }, view);
      if (ring) outlines.push(ring);
    }
    const previewCells = [];
    for (const tile of previewTiles) {
      if (tile.isConnected && tutorialVisibleRect(tile)) previewCells.push(tile);
    }
    for (const tile of tiles) {
      if (!tile.isConnected) continue;
      if (!tile.classList.contains('atk-origin') && !tile.classList.contains('atk-flip')
        && !tile.classList.contains('atk-neutral') && !tile.classList.contains('atk-blocked')
        && !tile.classList.contains('tutorial-target')) continue;
      if (!previewCells.includes(tile) && tutorialVisibleRect(tile)) previewCells.push(tile);
    }
    for (const tile of previewCells) {
      const rect = tutorialVisibleRect(tile);
      if (!rect) continue;
      const clamped = tutorialClampRect({
        x: rect.x - 5,
        y: rect.y - 5,
        width: rect.width + 10,
        height: rect.height + 10,
      }, view);
      if (clamped) addHole(clamped, 'preview');
    }
    tutorialMaskHoles.replaceChildren(...holes.map(
      ({ x, y, width, height }) => tutorialSvgRect(x, y, width, height),
    ));
    // Outlines already carry their 5px halo from the target loop; rx 8 (design §3).
    tutorialMaskOutlines.replaceChildren(...outlines.map(({ x, y, width, height }) => {
      const rect = tutorialSvgRect(x, y, width, height);
      rect.setAttribute('rx', '8');
      return rect;
    }));
    tutorialMaskEl.hidden = false;
    // Coach text: the same short substep hint the status line uses.
    tutorialCoachText.textContent = tutorialSubstepHint(tutorial.step, current);
    tutorialCoachEl.hidden = false;
    const barBottom = tutorialTopbar ? tutorialTopbar.getBoundingClientRect().bottom : 0;
    tutorialCoachEl.style.top = `${Math.round(barBottom + 8)}px`;
  }

  // Coalesce mask updates into one frame; render bursts (hand + preview +
  // controls per interaction) then hit this once.
  function tutorialScheduleMask() {
    if (tutorialMaskFrame !== null) return;
    tutorialMaskFrame = requestAnimationFrame(tutorialUpdateMask);
  }

  function tutorialHideMask() {
    if (tutorialMaskFrame !== null) {
      cancelAnimationFrame(tutorialMaskFrame);
      tutorialMaskFrame = null;
    }
    // Drop the punched rects too: a hidden mask with stale children must
    // never reappear (setup/formal residue check in acceptance §6).
    tutorialMaskHoles.replaceChildren();
    tutorialMaskOutlines.replaceChildren();
    tutorialMaskEl.hidden = true;
    tutorialCoachEl.hidden = true;
  }

  window.addEventListener('resize', tutorialScheduleMask);
  // Scrolling (locked board scroll, log scroll, any container) shifts target
  // rects; capture catches scrolls inside scrollable children too.
  window.addEventListener('scroll', tutorialScheduleMask, true);

  // renderHand hook: select substep keeps every card clickable (a wrong tap
  // gets a hint), drag/place keep the scripted card active (drag source), and
  // rotate/special/confirm disable the whole hand — there is nothing to pick
  // there (design 教学关-v1.2 §2: one action at a time).
  function tutorialRenderHand() {
    const scripted = tutorialScriptedCard();
    const current = tutorialSubstep();
    const selectionOpen = current === 'select' && tutorial.phase === 'place' && revealTimer === null;
    const handActive = selectionOpen || current === 'drag' || current === 'place';
    cards.forEach((button, index) => {
      const isScript = index === scripted;
      button.disabled = (!isScript && !selectionOpen) || !handActive
        || tutorial.phase !== 'place' || revealTimer !== null;
      // In the select substep non-scripted cards stay clickable so a wrong
      // tap can be answered with a hint; elsewhere they read as locked.
      button.setAttribute('aria-disabled', isScript || selectionOpen ? 'false' : 'true');
      button.classList.toggle('tutorial-locked', !isScript);
      button.classList.toggle('tutorial-script', isScript);
    });
  }

  function startGame(config, { promptMulligan = true } = {}) {
    // Any formal startMatch ends the tutorial (the setup button is hidden
    // during the tutorial, so this only fires from scripted/programmatic
    // entries). Skip-style cleanup: persist, clear UI, start formal.
    if (tutorial.active) {
      if (!tutorial.replay) markTutorialDone();
      tutorialCleanup();
      hideActionToast();
      if (resultDialog.open) resultDialog.close();
      closeMulliganDialog();
      setupView.hidden = true;
    }
    hideActionToast();
    closeMulliganDialog();
    closeDeckPeek(); // no peek dialog may survive a fresh match
    mulliganPrompted = false;
    const random = trial ? seededRandom(trial.seed) : Math.random;
    const next = rules.createGame(random, config);
    clearTimeout(revealTimer);
    revealTimer = null;
    // Restarting a match disarms any pending deal->prompt arming from the
    // previous game (v1.3.1/v1.3.3); startGame re-arms its own below.
    clearMulliganPromptArming();
    resultPending = false;
    if (resultDialog.open) resultDialog.close();
    game = next;
    activeConfig = config;
    matchRandom = random;
    // Deck viewer (v1.3.3): snapshot the full opening deck (hand + pile = 15)
    // so the peek dialog can always show all of it, even after cards leave
    // the pile via draws/mulligan/discard. Rules engine untouched.
    game.playerDeck = [...next.players.player.hand, ...next.players.player.pile];
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
    lastNextDrawKey = null; // opening render: the first chip shows, never flips
    // Fresh match: no baseline, so the opening renderScore never bumps.
    lastScoreState = null;
    lastSpState = null;
    renderGame();
    showBattle();
    clearMotion(); // a fresh formal game starts its own motion cleanly
    playMotionOnce(battleView, 'view-enter', 320);
    // v1.3.1: the opening deal plays first and the mulligan prompt waits for
    // it. v1.3.3: the 700ms clock starts after the deal's first rendered
    // frame (double rAF) so slow phones always show the dealing animation;
    // reduced motion still prompts near-instantly.
    playOpeningMotion();
    if (promptMulligan) {
      armMulliganPrompt();
    }
  }

  function resetPlacement() {
    rotation = 0;
    attack = false;
    locked = null;
    hovered = null;
  }

  // Recomputed once per turn (startGame / after resolveTurn), not on SP
  // changes — greying only depends on the board and the current hand.
  // A card stays bright when either a normal placement or a special attack
  // (SP + anchor checked inside hasAnyPlacement) is available.
  function computeLegality() {
    const player = game.players.player;
    return player.hand.map((card, slotIndex) => (
      card ? rules.hasAnyPlacement(game, 'player', slotIndex)
        || rules.hasAnyPlacement(game, 'player', slotIndex, { attack: true }) : false
    ));
  }

  function canPlay() {
    if (tutorial.active) {
      // Step 6 ends with finished=true; the controller owns the phase gates.
      // Substeps that accept board input only: select/rotate/special/confirm
      // keep the board inert (design 教学关-v1.2 §2/§4).
      return tutorial.phase === 'place' && revealTimer === null
        && tutorialBoardSubstep();
    }
    return Boolean(game && !game.finished && revealTimer === null);
  }

  function renderScore() {
    const counts = rules.score(game.board);
    // v1.3-B2: bump only on a real change after a baseline exists — the
    // opening render (startGame/tutorial step) and view switches stay still.
    const scoreChanged = Boolean(lastScoreState)
      && (lastScoreState.player !== counts.player || lastScoreState.cpu !== counts.cpu);
    const spState = { player: game.players.player.sp, cpu: game.players.cpu.sp };
    const spChanged = Boolean(lastSpState)
      && (lastSpState.player !== spState.player || lastSpState.cpu !== spState.cpu);
    for (const side of ['player', 'cpu']) {
      byId(`${side}-score`).textContent = twoDigits(counts[side]);
      const sp = byId(`${side}-sp`);
      sp.querySelector('strong').textContent = game.players[side].sp;
      sp.setAttribute('aria-label', `${game.players[side].sp} 点特殊能量`);
    }
    if (scoreChanged) {
      // Unique timer keys: the two sides share the class, so the default
      // className key would let one side's timer evict the other's.
      playMotionOnce(byId('player-score'), 'score-bump', 420, 'score-player');
      playMotionOnce(byId('cpu-score'), 'score-bump', 420, 'score-cpu');
      playMotionOnce(byId('turf-bar'), 'turf-bump', 420, 'turf-bar');
    }
    if (spChanged) {
      playMotionOnce(byId('player-sp'), 'sp-bump', 420, 'sp-player');
      playMotionOnce(byId('cpu-sp'), 'sp-bump', 420, 'sp-cpu');
    }
    lastScoreState = { player: counts.player, cpu: counts.cpu };
    lastSpState = spState;

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
    // Deck viewer (v1.3.3): keep the accessible name in sync with the count
    // ("查看牌库，剩余 X 张"); the visible compact text is untouched.
    deckPeekButton.setAttribute('aria-label', `查看牌库，剩余 ${player.pile.length} 张`);
    deckPeekButton.title = '查看本局牌库';
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
      button.setAttribute('aria-label', `${card.name}，${card.size} 格。普通落子不需要能量；特殊攻击消耗 ${card.cost} SP。${placeable ? '' : '普通落子和特攻都不可用。'}`);
      const marker = `<span class="card-top-marker"><kbd>${index + 1}</kbd>${placeable ? '' : '<span class="no-placement-mark" aria-hidden="true">放不下</span>'}</span>`;
      button.innerHTML = cardMarkup(card, selected ? rotation : 0, marker);
    }
    if (dimmed) byId('dimmed-note').textContent = '变暗的牌普通落点和特攻都放不下，仍可弃牌。';
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

  // Drag ghost content (v1.3.1): a board-consistent footprint — square cells
  // laid out on the card's rotated grid — instead of the full card face.
  // Same shapeCells data as the board preview, so what follows the finger
  // matches what will land on the board (no name/cost/card shell).
  function ghostFootprintMarkup(card, turn) {
    const pose = card.rotations[turn];
    return `<span class="ghost-shape" style="--ghost-cols:${pose.width};--ghost-rows:${pose.height}" aria-hidden="true">${shapeCells(pose)}</span>`;
  }

  // =====================================================================
  // Deck viewer (v1.3.3): a read-only look at this match's full 15-card
  // deck. Cards still in player.pile are "remaining" (normal face); every
  // other card of the opening deck — current hand, discards, already-played
  // — is "drawn" (greyed + overlay). playerDeck is a startGame snapshot of
  // the opening deck, so a mulligan swap can never lose the old hand cards:
  // they flip back to "remaining" the moment they return to the pile.
  // =====================================================================

  // Render the peek dialog body. Safe no-op without a formal game (the
  // tutorial hides .hand-deck entirely, so its button can't be reached).
  function renderDeckPeek() {
    if (!game || trial || tutorial.active) return;
    const player = game.players.player;
    // Identity matching against live card objects: a mulligan returns an old
    // hand card to the pile and it counts as remaining again.
    const remaining = game.playerDeck.filter((card) => player.pile.includes(card));
    const drawn = game.playerDeck.filter((card) => !player.pile.includes(card));
    byId('deck-peek-summary').textContent =
      `剩余 ${remaining.length} 张 · 已抽到 ${drawn.length} 张`;
    byId('deck-peek-grid').innerHTML = [...remaining, ...drawn]
      .map((card) => {
        const inPile = player.pile.includes(card);
        const marker = inPile ? '' : '<span class="deck-peek-mark" aria-hidden="true">已抽到</span>';
        return `<div class="deck-peek-card${inPile ? '' : ' drawn'}">${cardMarkup(card, 0, marker)}</div>`;
      })
      .join('');
  }

  function openDeckPeek() {
    if (trial || tutorial.active || !game || deckPeekDialog.open) return;
    renderDeckPeek();
    deckPeekDialog.showModal();
  }

  function closeDeckPeek() {
    if (deckPeekDialog.open) deckPeekDialog.close();
  }

  deckPeekButton.addEventListener('click', openDeckPeek);

  // One cleanup sweep for every close path (Esc cancel, form-method ×,
  // programmatic close): the rendered snapshot goes stale the moment the
  // match advances, so the grid is emptied instead of kept around.
  deckPeekDialog.addEventListener('close', () => {
    byId('deck-peek-grid').replaceChildren();
  });

  // Ghost geometry follows the live board: cell size and gap are measured
  // from #board each time a drag starts, so the footprint is the same size
  // as the tiles it hovers (and stays right after rotation/resize).
  function syncGhostMetrics() {
    const rect = board.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = getComputedStyle(board);
    const gap = parseFloat(style.columnGap) || 0;
    const cell = (rect.width - gap * (COLS - 1)) / COLS;
    const rowHeight = (rect.height - gap * (ROWS - 1)) / ROWS;
    dragGhost.style.setProperty('--ghost-cell', `${cell}px`);
    dragGhost.style.setProperty('--ghost-row', `${rowHeight}px`);
    dragGhost.style.setProperty('--ghost-gap', `${gap}px`);
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
    // v1.3-B1: the refill chip flips once when the upcoming card actually
    // changes (a draw consumed one). Name+shape key: same name can repeat.
    // v1.3-B2: only a settled turn (lastTurn non-null) may flip — a mulligan
    // at the opening of a second game swaps the pile before any settle, and
    // must only refresh the key, never flash the chip.
    const key = card ? `${card.name}:${card.rotations[0].cells.length}` : null;
    if (key !== lastNextDrawKey) {
      const first = lastNextDrawKey === null; // opening deal: no flip
      lastNextDrawKey = key;
      if (!first && key && lastTurn) playMotionOnce(byId('next-draw'), 'flip', 320);
    }
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
    // #board.attack-focus dims non-core tiles in CSS while aiming a special
    // attack. Toggled on every render, so cancel/confirm/turn-end clears it
    // as soon as `attack` returns to false.
    board.classList.toggle('attack-focus', Boolean(attack));
    if (tutorial.active) {
      const keepTiles = previewTiles;
      previewTiles = [];
      // Clear every old preview class up front (including preview-core, which
      // would otherwise survive a rotation when the core cell moves), then
      // rebuild the new preview below.
      for (const cell of keepTiles) {
        cell.classList.remove('preview', 'preview-core', 'locked', 'invalid', 'attacking');
      }
      for (const tile of tiles) tile.classList.remove(...ATk_CLASSES);
      if (targetTile) targetTile.removeAttribute('data-target');
      targetTile = null;
      const scripted = tutorial.step.player;
      const current = tutorialSubstep();
      // Ghost preview: drag/place (hover or locked anchor), the confirm
      // substep's locked anchor, and a rotate substep that already locked
      // the anchor (01: the player must see the shape they are turning).
      // select/special stay clean; 02's rotate has no locked anchor yet.
      // v1.3-B2: the reveal window keeps the locked preview visible so the
      // reveal breathe has a target (phase flips to 'reveal' before this
      // render and to 'explain' at the settle); the settle render clears it.
      const previewSubstep = current === 'drag' || current === 'place' || current === 'confirm'
        || (current === 'rotate' && locked);
      const target = (tutorial.phase === 'place' && revealTimer === null && previewSubstep)
        || (tutorial.phase === 'reveal' && locked)
        ? locked ?? hovered : null;
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
      if (tutorial.phase === 'place' && revealTimer === null && attack
        && (current === 'special' || current === 'place' || current === 'confirm')) {
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
          const scriptedPreview = rules.inspectMove(game, 'player', {
            slot: scripted.slot,
            rotation: scripted.rotation,
            x: scripted.x,
            y: scripted.y,
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

    // v1.3-B2: during the 240ms lock window (canPlay false, revealTimer
    // running) the locked preview stays visible so the reveal breathe has a
    // target; the settle render clears it via resetPlacement. No input is
    // restored — renderControls still reports 双方已锁牌.
    const target = canPlay() ? locked ?? hovered ?? openingPreview()
      : revealTimer !== null && locked ? locked : null;
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
    if (tutorial.active) {
      if (tutorial.phase !== 'place' || revealTimer !== null) return;
      const current = tutorialSubstep();
      if (current === 'select') {
        if (index === tutorialScriptedCard()) {
          // Picked the scripted card: enter the drag substep unselected
          // (slot stays null; the drag itself selects via substep entry).
          slot = tutorialScriptedCard();
          rotation = 0;
          advanceTutorialSubstep('drag');
          renderHand();
          renderPreview();
          return;
        }
        tutorialHint(tutorial.step.hint.card);
        return;
      }
      // Non-select substeps: taps on cards are inert (card is preselected).
      return;
    }
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
    if (tutorial.active) {
      if (tutorial.phase !== 'place' || revealTimer !== null) return;
      if (tutorialSubstep() !== 'rotate') return; // hidden elsewhere anyway
      rotation = (rotation + direction + 4) % 4;
      renderHand();
      renderPreview();
      const step = tutorial.step;
      const scripted = step.player.rotation;
      if (rotation === scripted) {
        // 01: rotate -> confirm; 02: rotate -> place (design 教学关-v1.2 §2).
        advanceTutorialSubstep(step.id === '01' ? 'confirm' : 'place');
        return;
      }
      if (step.id === '02' && rotation === 1) {
        // 02 goes 0 -> 1 -> 2; r1 is the expected midpoint (one click past
        // the start). Not an error: clear the status extra and keep the
        // standard 旋转方向 guidance (no red invalid state, no error count).
        tutorialRenderSubstepStatus('');
        return;
      }
      // Any other off-script direction (Shift+R backwards, or 01 turning the
      // wrong way) counts as an error with a hint; 3 in a row offers skip.
      tutorialHint(step.hint.rotation ?? '方向不对，再点「旋转」调整。');
      return;
    }
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
    // The opening dialog is the primary affordance; while it is open the
    // inline button would be a dead duplicate behind the modal (QA P3 #2).
    const show = !trial && canPlay() && game.round === 1 && !game.mulliganUsed.player
      && !mulliganDialog.open;
    mulliganButton.hidden = !show;
  }

  // =====================================================================
  // Opening mulligan dialog (v1.2 A): after a formal startGame the player
  // gets one modal prompt. Either button consumes the one-time opportunity
  // (keep sets the flag without swapping), so the #mulligan button never
  // offers a second chance and the dialog can't be reopened via Esc.
  // =====================================================================

  function maybePromptMulligan() {
    clearMulliganPromptArming();
    if (mulliganPrompted) return false;
    if (trial || tutorial.active) return false;
    // Delayed-fire guards: the game/view must still be live round 1 with the
    // chance unconsumed when the deal timer lands (v1.3.1).
    if (!game || game.finished || game.round !== 1 || game.mulliganUsed.player) return false;
    if (battleView.hidden || revealTimer !== null) return false;
    mulliganPrompted = true;
    mulliganDialog.showModal();
    updateMulliganButton(); // hide the inline duplicate behind the dialog
    mulliganKeepButton.focus();
    return true;
  }

  function closeMulliganDialog() {
    if (mulliganDialog.open) mulliganDialog.close();
  }

  // Keep: consume the opportunity without swapping; the hand stays as is.
  // The opening deal already played (v1.3.1) — no second deal on keep.
  function keepMulligan() {
    closeMulliganDialog();
    if (!game || trial || tutorial.active || game.mulliganUsed.player) return;
    game.mulliganUsed.player = true;
    // Dialog closed but flag consumed: keep the button hidden either way.
    updateMulliganButton();
    status.textContent = '保留当前手牌，本局不能再换';
    status.dataset.state = 'valid';
    board.focus({ preventScroll: true });
  }

  // Redraw: reuse the engine's one-time mulligan (swap + refresh renders),
  // then replay the opening deal so the swapped hand visibly deals in.
  function redrawMulligan() {
    closeMulliganDialog();
    takeMulligan();
    board.focus({ preventScroll: true });
    playOpeningMotion();
  }

  // Esc / dialog cancel counts as "keep": the opportunity must never be
  // left unconsumed behind a dismissed dialog.
  mulliganDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    keepMulligan();
  });
  mulliganKeepButton.addEventListener('click', keepMulligan);
  mulliganRedrawButton.addEventListener('click', redrawMulligan);

  function toggleSpecial() {
    if (battleView.hidden || rulesDialog.open) return;
    if (tutorial.active) {
      if (tutorial.phase !== 'place' || revealTimer !== null) return;
      if (tutorialSubstep() !== 'special') return; // hidden elsewhere anyway
      if (attack) {
        // Cancel keeps the player in the special substep (design §2).
        attack = false;
        renderHand();
        renderPreview();
        tutorialRenderSubstepStatus('');
        return;
      }
      attack = true;
      renderHand();
      renderPreview();
      // Attack lit: move on to placing the scripted special attack.
      advanceTutorialSubstep('place');
      return;
    }
    if (!canPlay()) return;
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
    clearMotion(); // result dialog: no dealing/shuffling residue behind it
    closeMulliganDialog();
    closeDeckPeek();
    // The deal->prompt arming must never fire into a finished match.
    clearMulliganPromptArming();
    const counts = rules.score(game.board);
    const won = counts.player > counts.cpu;
    const unlocked = won && !trial ? setup.awardVictory() : [];
    byId('result-title').textContent = won ? '你赢了！' : counts.player < counts.cpu ? '电脑获胜' : '平局';
    byId('result-player').textContent = counts.player;
    byId('result-cpu').textContent = counts.cpu;
    // v1.3-B2: one settle-in bounce for the final score figures.
    playMotionOnce(document.querySelector('.result-scores'), 'result-bump', 460, 'result-scores');
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
    // v1.3-B2: preview tiles breathe while both sides are locked (240ms),
    // then the class clears itself after 380ms — past the settle render.
    playMotionOnce(board, 'revealing', 380, 'board-reveal');
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

  // Hand drags lift the ghost above the finger so it stays visible under it;
  // board re-drag keeps zero lift — the finger sits on the tile it means to
  // grab, so a lifted hit-test would read a cell one row above (v1.3.3).
  const DRAG_THRESHOLD_PX = 8;
  const DRAG_LIFT_PX = 56;
  const BOARD_DRAG_LIFT_PX = 0;

  // Lift that applies to this drag's hit-tests and ghost positioning.
  function dragLiftPx() {
    return drag.board ? BOARD_DRAG_LIFT_PX : DRAG_LIFT_PX;
  }

  // pointerdown on a hand card: remember press state; the card's click
  // handler still owns tap selection. Only touches/pens can become drags.
  // Tutorial (v1.2): hand drags open in the drag/place substeps only, from
  // the scripted card, with no rules dialog covering the board.
  function beginDragPress(event, slotIndex) {
    if (!drag.enabled || event.pointerType === 'mouse') return;
    if (battleView.hidden || rulesDialog.open) return;
    if (tutorial.active) {
      const current = tutorialSubstep();
      if (current !== 'drag' && current !== 'place') return;
      if (slotIndex !== tutorialScriptedCard()) return;
    } else if (!canPlay()) {
      return;
    }
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
    dragGhost.style.top = `${clientY - dragLiftPx()}px`;
  }

  function onDragMove(event) {
    if (event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Crossed the threshold: enter dragging and select the pressed card.
      drag.active = true;
      if (drag.board) {
        enterBoardDrag();
      } else {
        if (tutorial.active) {
          // The scripted card is already selected in the drag/place substep;
          // never re-route through selectCard (it would trip the substep).
          const card = draggingCard();
          if (!card) { cancelDrag(); return; }
          card.classList.add('dragging');
          const pressed = game.players.player.hand[drag.slot];
          dragGhost.innerHTML = ghostFootprintMarkup(pressed, drag.dragRotation);
          syncGhostMetrics();
          dragGhost.hidden = false;
          locked = null;
          hovered = null;
        } else {
          selectCard(drag.slot);
          const card = draggingCard();
          if (!card) { cancelDrag(); return; }
          card.classList.add('dragging');
          const player = game.players.player;
          const pressed = player.hand[drag.slot];
          dragGhost.innerHTML = ghostFootprintMarkup(pressed, drag.dragRotation);
          syncGhostMetrics();
          dragGhost.hidden = false;
          locked = null;
          hovered = null;
        }
      }
    }
    event.preventDefault();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      moveGhost(drag.lastX, drag.lastY);
      const target = targetFromPoint(drag.lastX, drag.lastY - dragLiftPx());
      // v1.3.1: over the board the ghost hides so the real target tile shows
      // through (.tile.preview carries the shape); off-board the footprint
      // ghost follows the finger.
      dragGhost.hidden = target !== null;
      const changed = target?.x !== hovered?.x || target?.y !== hovered?.y;
      if (changed) {
        hovered = target;
        renderPreview();
      }
    });
  }

  // Board drag start: drop the locked anchor and re-anchor the shared ghost
  // to the current card shape; the preview then follows via hovered. The
  // ghost starts hidden (the press is on a board tile): the next pointermove
  // shows it only while the lifted finger is off the board (v1.3.1).
  function enterBoardDrag() {
    const card = game.players.player.hand[slot];
    if (!card) { cancelBoardDragPress(); return; }
    dragGhost.innerHTML = ghostFootprintMarkup(card, rotation);
    syncGhostMetrics();
    dragGhost.hidden = true;
    setBoardDragTouchAction(true);
    locked = null;
    hovered = null;
    renderPreview();
    moveGhost(drag.startX, drag.startY);
  }
  // (end of board re-drag section)

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
    if (drag.board) setBoardDragTouchAction(false);
    drag.pointerId = null;
    drag.slot = null;
    drag.board = false;
    drag.active = false;
  }

  // Board drag cancel: bring back the locked anchor and its preview.
  function restoreBoardDrag() {
    locked = drag.boardPrevLocked;
    hovered = null;
    renderPreview();
  }

  // Press never became a drag: clean listeners, keep locked intact.
  function cancelBoardDragPress() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    drag.pointerId = null;
    drag.board = false;
    drag.active = false;
  }

  function onDragEnd(event) {
    if (event.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    const wasBoard = drag.board; // endDragCommon resets the flags
    endDragCommon();
    if (!wasActive) return; // plain tap: card's click handler proceeds
    // Swallow the click that follows a real drag so it can't re-select.
    drag.pendingClick = true;
    setTimeout(() => { drag.pendingClick = false; }, 0);
    const target = targetFromPoint(event.clientX, event.clientY - (wasBoard ? BOARD_DRAG_LIFT_PX : DRAG_LIFT_PX));
    if (wasBoard) {
      if (target) {
        setTarget(target);
      } else {
        restoreBoardDrag();
      }
      return;
    }
    if (tutorial.active) {
      // Tutorial hand drag: only the scripted cell locks; wrong cells and
      // off-board drops stay in the drag substep with a hint (design §4).
      if (target) setTutorialDragTarget(target);
      else tutorialHint(`松手要落在高亮格 ${positionName(tutorialTarget())}。`);
      return;
    }
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
    const wasBoard = drag.board; // endDragCommon resets the flags
    endDragCommon();
    if (!wasActive) return;
    drag.pendingClick = true;
    setTimeout(() => { drag.pendingClick = false; }, 0);
    if (wasBoard) {
      restoreBoardDrag();
      return;
    }
    if (tutorial.active) {
      // Interrupted tutorial drag: stay in the substep with a hint.
      tutorialHint(`按住卡牌拖到高亮格 ${positionName(tutorialTarget())}。`);
      return;
    }
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
    const wasBoard = drag.board; // endDragCommon resets the flags
    endDragCommon();
    if (wasBoard) {
      restoreBoardDrag();
      return;
    }
    if (tutorial.active) {
      // Interrupted tutorial drag: stay in the substep, never restore a
      // snapshot that could unlock the scripted state.
      tutorialHint(`按住卡牌拖到高亮格 ${positionName(tutorialTarget())}。`);
      return;
    }
    restoreDragSnapshot();
  }

  // Tutorial drag drop: wrong cell → hint, stay in the substep, never lock;
  // scripted cell → lock and advance (drag→rotate/confirm, place→confirm).
  function setTutorialDragTarget(target) {
    const scripted = tutorial.step.player;
    const onTarget = target.x === scripted.x && target.y === scripted.y;
    if (!onTarget) {
      hovered = null;
      renderPreview();
      tutorialHint(`要落到高亮格 ${positionName(tutorialTarget())}。`);
      return;
    }
    locked = target;
    hovered = null;
    board.focus({ preventScroll: true });
    advanceTutorialSubstep(tutorialSubstep() === 'drag'
      ? (tutorial.step.id === '01' ? 'rotate' : 'confirm')
      : 'confirm');
  }

  function setTarget(target) {
    if (tutorial.active) {
      // Board input only fires in drag/place substeps (canPlay gate), but a
      // trailing click or stray pointer can still land here: wrong cell gets
      // a hint and never locks the anchor.
      if (tutorial.phase !== 'place' || revealTimer !== null) return;
      setTutorialDragTarget(target);
      return;
    }
    locked = target;
    hovered = null;
    board.focus({ preventScroll: true });
    renderPreview();
  }

  board.addEventListener('pointermove', (event) => {
    if (tutorial.active) return; // tutorial: no mouse hover preview
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
    // A board drag that just released dispatches a trailing click; its hit
    // tile is under the finger, not the lifted ghost, so it would move the
    // anchor set by onDragEnd. Swallow it like the hand-card click does.
    if (drag.pendingClick) {
      event.preventDefault();
      return;
    }
    const target = pointFromEvent(event);
    if (target && canPlay()) setTarget(target);
  });

  // =====================================================================
  // Board re-drag of a locked preview (v1.2 B, touch/pen only). The hand
  // drag owns placement; this path only moves the already-locked anchor
  // between tiles. Mouse keeps plain click/hover.
  // =====================================================================

  function beginBoardDragPress(event) {
    if (!drag.enabled || event.pointerType === 'mouse') return;
    if (tutorial.active) return; // board re-drag stays formal-only (v1.2 §2)
    if (!locked || !canPlay() || battleView.hidden || rulesDialog.open) return;
    // Anchor press only: a locked-preview tile or the outlined target tile.
    const tile = event.target.closest('[data-cell]');
    if (!tile || !(tile.classList.contains('preview') || tile.hasAttribute('data-target'))) return;
    drag.pointerId = event.pointerId;
    drag.board = true;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.active = false;
    drag.boardPrevLocked = locked;
    drag.dragRotation = rotation;
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }

  board.addEventListener('pointerdown', beginBoardDragPress);

  // Keep page scroll from stealing touch drags that start on the board's
  // locked preview; restored when the drag ends.
  function setBoardDragTouchAction(on) {
    board.style.touchAction = on ? 'none' : '';
  }

  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  window.addEventListener('blur', () => {
    if (drag.active || drag.pointerId !== null) cancelDrag();
  });

  window.addEventListener('keydown', (event) => {
    // Deck peek (v1.3.3): a modal dialog must not let hotkeys steer the
    // match behind it (same reasoning as the rulesDialog guard below).
    if (battleView.hidden || rulesDialog.open || deckPeekDialog.open
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (tutorial.active) {
      const key = event.key.toLowerCase();
      const current = tutorialSubstep();
      // Enter works in confirm (submit) and explain (next) regardless of
      // the canPlay substep gate.
      if (key === 'enter') {
        if (tutorial.phase === 'place' && current === 'confirm'
          && !submitButton.hidden && !submitButton.disabled && tutorialNextButton.hidden) {
          event.preventDefault();
          tutorialConfirm();
        } else if (tutorial.phase === 'explain' && !tutorialNextButton.hidden && !tutorialNextButton.disabled) {
          event.preventDefault();
          tutorialNext();
        }
        return;
      }
      if (tutorial.phase !== 'place' || revealTimer !== null) return;
      if (/^[1-4]$/.test(key)) {
        const index = Number(key) - 1;
        if (current === 'select') {
          if (index === tutorialScriptedCard()) selectCard(index);
          else tutorialHint(tutorial.step.hint.card);
        }
      } else if (key === 'r') {
        if (current === 'rotate') rotateCard(event.shiftKey ? -1 : 1);
      } else if (key === 'e') {
        event.preventDefault();
        if (!event.repeat && current === 'special') toggleSpecial();
      } else if (arrows[event.key] && tutorialBoardSubstep()) {
        event.preventDefault();
        const scripted = tutorial.step.player;
        // Arrow moves walk from the last tried cell (or the scripted anchor
        // on the first press), so a move away and back can reach the
        // scripted cell by keyboard alone (acceptance: 键盘可完成第 1 步).
        const base = locked ?? tutorial.arrowBase ?? { x: scripted.x, y: scripted.y };
        const x = base.x + arrows[event.key][0];
        const y = base.y + arrows[event.key][1];
        if (rules.inBounds(x, y)) setTarget({ x, y });
        if (!locked) tutorial.arrowBase = { x, y };
      }
      return;
    }
    if (!canPlay()) return;
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
    deckPeekButton.hidden = true; // no deck peek in trial (openDeckPeek guards too)
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
