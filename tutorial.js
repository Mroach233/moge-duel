// Scripted tutorial (design: docs/design/教学关-v1.1.md).
// Data + factories only — no DOM, no randomness, no formal-flow calls.
// The engine (rules.inspectMove / resolveTurn / score) stays the single
// source of truth: this module only pins the INPUTS (board, hands, SP,
// round, both sides' scripted moves). Expect values are assertions for the
// Node test suite, never used to fake results at runtime.
//
// Part A: data / factory / pure runner. Part B (controller + UI hooks)
// comes separately and must not touch anything in this file's scope.
(function () {
  'use strict';

  // Dependency injection so Node tests and the browser share one module:
  // `createInkTutorial(rules)` builds the API; the UMD tail passes the real
  // rules when available.
  function createInkTutorial(rules) {
    const { ROWS, COLS, ROUNDS, CARDS, DIFFICULTIES } = rules;

    const TUTORIAL_KEY = 'ink-duel-tutorial-v1';

    // Practice map geometry (13 cols x 11 rows) — cloned verbatim so the
    // tutorial introduces no new walls/geometry. Never added to rules.MAPS.
    const PRACTICE_CELLS = [
      '##.........##',
      '#...........#',
      '.............',
      '....#...#....',
      '.............',
      '..P.......C..',
      '.............',
      '....#...#....',
      '.............',
      '#...........#',
      '##.........##',
    ];

    // Fixed hand for every step (same 4 slots each time; the controller
    // locks all but the scripted card).
    const HAND_IDS = ['short', 'elbow', 'cross', 'drop'];

    // ------------------------------------------------------------------
    // 6 steps. Board symbols: `#` wall, `.` empty, `p`/`c` normal ink,
    // `P`/`C` player/cpu core (charged via `charged`), `X` clash lock.
    // Board strings are the single source of truth per step; steps 1-5 are
    // consecutive (next initial = previous result), step 6 is an isolated
    // round-12 endgame snapshot.
    // ------------------------------------------------------------------
    const TUTORIAL_STEPS = [
      {
        id: '01',
        title: '贴地落子',
        goal: '普通落子必须贴己方墨',
        instruction: '点「旋转」1 次，把 1 号「短线」转竖；落到 D05。',
        board: [
          '##.........##',
          '#...........#',
          '.............',
          '....#...#....',
          '.............',
          '..P.......C..',
          '.............',
          '....#...#....',
          '.............',
          '#...........#',
          '##.........##',
        ],
        charged: [],
                score: { player: 1, cpu: 1 },
        round: 1,
        sp: { player: 0, cpu: 0 },
        player: { slot: 0, card: 'short', rotation: 1, x: 3, y: 4, attack: false },
        cpu: { slot: 0, card: 'short', rotation: 1, x: 9, y: 4, attack: false },
        expect: {
          score: { player: 4, cpu: 4 },
          sp: { player: 0, cpu: 0 },
          collisions: 0,
          blocked: 0,
          charged: [],
        },
        explain: '你的「短线」盖了 D04–D06，其中 D06 斜贴着你的 C06，所以合法；电脑的 J04–J06 也贴着 K06。双方各 +3，4:4。',
        hint: {
          target: '落到高亮的 D05。',
          rotation: '先点「旋转」，转到 r1（竖）；当前方向盖不到 D06。',
          card: '本步只用 1 号「短线」。',
        },
        nextLabel: '下一步',
      },
      {
        id: '02',
        title: '旋转',
        goal: '旋转改变覆盖格，绕开墙和已占格',
        instruction: '选 2 号「折角」，点「旋转」2 次；落到 F04。',
        board: [
          '##.........##',
          '#...........#',
          '.............',
          '...P#...#C...',
          '...p.....c...',
          '..Pp.....cC..',
          '.............',
          '....#...#....',
          '.............',
          '#...........#',
          '##.........##',
        ],
        charged: [],
                score: { player: 4, cpu: 4 },
        round: 2,
        sp: { player: 0, cpu: 0 },
        player: { slot: 1, card: 'elbow', rotation: 2, x: 5, y: 3, attack: false },
        cpu: { slot: 1, card: 'elbow', rotation: 0, x: 8, y: 4, attack: false },
        expect: {
          score: { player: 7, cpu: 7 },
          sp: { player: 0, cpu: 0 },
          collisions: 0,
          blocked: 0,
          charged: [],
        },
        explain: 'E03 斜贴着 D04，F04 是空格，所以「折角」的 r2 能落；其他方向会撞 E04 的墙或不贴己方墨。旋转不是装饰：同一个落点，转错方向就放不下。',
        hint: {
          target: '落到高亮的 F04。',
          rotation: '再点「旋转」到 r2；其他方向会撞 E04 的墙或不贴己方墨。',
          card: '本步只用 2 号「折角」。',
        },
        nextLabel: '下一步',
      },
      {
        id: '03',
        title: '同时揭晓',
        goal: '双方同时揭晓；特殊格优先；同类同大小撞成封锁',
        instruction: '1 号「短线」已转好；落到 G04，和电脑同时揭晓。',
        board: [
          '##.........##',
          '#...........#',
          '....pp.......',
          '...P#P.C#C...',
          '...p...ccc...',
          '..Pp.....cC..',
          '.............',
          '....#...#....',
          '.............',
          '#...........#',
          '##.........##',
        ],
        charged: [],
                score: { player: 7, cpu: 7 },
        round: 3,
        sp: { player: 0, cpu: 0 },
        player: { slot: 0, card: 'short', rotation: 3, x: 6, y: 3, attack: false },
        cpu: { slot: 0, card: 'short', rotation: 1, x: 6, y: 3, attack: false },
        expect: {
          score: { player: 8, cpu: 8 },
          sp: { player: 0, cpu: 0 },
          collisions: 3,
          blocked: 1,
          charged: [],
        },
        explain: '这一手双方同时落在 G03–G05：G03 是电脑的特殊格，特殊格优先；G05 是你的特殊格；G04 两边都是普通格、都是 3 格，撞成封锁。撞格 3，封锁 1。你 +1，电脑 +1，8:8。',
        hint: {
          target: '落到高亮的 G04；这一手双方会同时落在 G03–G05。',
          rotation: null,
          card: '本步只用 1 号「短线」。',
        },
        nextLabel: '下一步',
      },
      {
        id: '04',
        title: '攒 SP',
        goal: 'SP 来自围满特殊格；墙和撞格也算填满',
        instruction: '2 号「折角」已转好；落到 F06，围满你的特殊格 F04。',
        board: [
          '##.........##',
          '#...........#',
          '....ppC......',
          '...P#PXC#C...',
          '...p..Pccc...',
          '..Pp.....cC..',
          '.............',
          '....#...#....',
          '.............',
          '#...........#',
          '##.........##',
        ],
        charged: [],
                score: { player: 8, cpu: 8 },
        round: 4,
        sp: { player: 0, cpu: 0 },
        player: { slot: 1, card: 'elbow', rotation: 1, x: 5, y: 5, attack: false },
        cpu: { slot: 3, card: 'drop', rotation: 0, x: 10, y: 4, attack: false },
        expect: {
          score: { player: 11, cpu: 9 },
          sp: { player: 1, cpu: 0 },
          collisions: 0,
          blocked: 0,
          charged: ['F04'],
        },
        explain: 'F04 周围 8 格原来只差 E05、F05；你这一手补上后，8 格全非空，F04 充能，+1 SP。墙和撞格也算「填满」。普通落子本身不花 SP。你现在 1 SP，下一手可以特攻。',
        hint: {
          target: '落到高亮的 F06；先看 F04 周围只差 E05/F05。',
          rotation: null,
          card: '本步只用 2 号「折角」。',
        },
        nextLabel: '下一步',
      },
      {
        id: '05',
        title: '特攻',
        goal: '特攻消耗 SP，从己方特殊格旁反涂敌墨',
        instruction: '点「特殊攻击」，把 1 号「短线」落到 I05。',
        board: [
          '##.........##',
          '#...........#',
          '....ppC......',
          '...P#PXC#C...',
          '...ppPPcccC..',
          '..Ppp....cC..',
          '.............',
          '....#...#....',
          '.............',
          '#...........#',
          '##.........##',
        ],
        charged: ['F04'],
                score: { player: 11, cpu: 9 },
        round: 5,
        sp: { player: 1, cpu: 0 },
        player: { slot: 0, card: 'short', rotation: 0, x: 8, y: 4, attack: true },
        cpu: { slot: 3, card: 'drop', rotation: 0, x: 10, y: 3, attack: false },
        expect: {
          score: { player: 14, cpu: 7 },
          sp: { player: 0, cpu: 0 },
          collisions: 0,
          blocked: 0,
          charged: [],
        },
        explain: '起点 G05 是你的特殊格，H05–J05 是电脑的普通墨，所以这一手能反涂 3 格，花 1 SP。特攻不能盖墙、撞格和特殊格；反涂后的格子是你的普通墨。你 +3，电脑净 -2；14:7。',
        hint: {
          target: '本步落 I05；起点 G05 会亮金框。',
          rotation: null,
          card: '本步只用 1 号「短线」。',
        },
        nextLabel: '下一步',
      },
      {
        id: '06',
        title: '胜负',
        goal: '12 回合后占格多者胜；最后一手能翻盘',
        instruction: '快进到第 12 回合：最后一手把 1 号「短线」落到 G05。',
        board: [
          '##.........##',
          '#ppppp.ccccc#',
          'pppppp.cccccc',
          'pppp#p.c#cccc',
          'ppppp..cccc.c',
          'ppPpp..cccCcc',
          'pppppp.cccccc',
          'pppp#p.c#cccc',
          'pppppp.cccccc',
          '#ppppp.ccccc#',
          '##.........##',
        ],
        charged: ['C06'],
                score: { player: 48, cpu: 49 },
        round: ROUNDS, // 12 — endgame snapshot, not a continuation of step 5
        sp: { player: 0, cpu: 0 },
        player: { slot: 0, card: 'short', rotation: 1, x: 6, y: 4, attack: false },
        cpu: { slot: 3, card: 'drop', rotation: 0, x: 11, y: 4, attack: false },
        expect: {
          score: { player: 51, cpu: 50 },
          sp: { player: 0, cpu: 2 },
          collisions: 0,
          blocked: 0,
          charged: ['L05', 'K06'],
          finished: true,
        },
        explain: '你从 48:49 落后 1 格，到 51:50 赢 1 格；12 回合后占格多的一方获胜。电脑的 L05 落下后 L05 和 K06 都充能，但 SP 不改变占格结果，终局只看格数。',
        hint: {
          target: '最后一手落 G05；这一手 +3 刚好翻盘。',
          rotation: null,
          card: '本步只用 1 号「短线」。',
        },
        nextLabel: '进入对局',
      },
    ];

    // ------------------------------------------------------------------
    // Board parsing
    // ------------------------------------------------------------------
    function positionName({ x, y }) {
      return String.fromCharCode(65 + x) + String(y + 1).padStart(2, '0');
    }

    function parsePosition(name) {
      return { x: name.charCodeAt(0) - 65, y: Number(name.slice(1)) - 1 };
    }

    // `#` wall, `.` empty, `p`/`c` normal ink, `P`/`C` cores, `X` clash.
    // `charged` names mark the matching core with charged=true.
    function parseBoard(rows, charged = []) {
      if (rows.length !== ROWS || rows.some((row) => row.length !== COLS)) {
        throw new RangeError(`Tutorial board must be ${ROWS}x${COLS}`);
      }
      const chargedSet = new Set(charged);
      const board = [];
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const symbol = rows[y][x];
          if (symbol === '#') board.push({ kind: 'wall' });
          else if (symbol === 'X') board.push({ kind: 'clash' });
          else if (symbol === 'p' || symbol === 'P') {
            const core = symbol === 'P';
            const tile = { kind: core ? 'core' : 'ink', owner: 'player' };
            if (core && chargedSet.has(positionName({ x, y }))) tile.charged = true;
            board.push(tile);
          } else if (symbol === 'c' || symbol === 'C') {
            const core = symbol === 'C';
            const tile = { kind: core ? 'core' : 'ink', owner: 'cpu' };
            if (core && chargedSet.has(positionName({ x, y }))) tile.charged = true;
            board.push(tile);
          } else if (symbol === '.') board.push({ kind: 'empty' });
          else throw new RangeError(`Unknown tutorial board symbol '${symbol}' at ${positionName({ x, y })}`);
        }
      }
      return board;
    }

    // ------------------------------------------------------------------
    // Game factory (hand-built from scratch; no rules factory, zero randomness)
    // ------------------------------------------------------------------
    function createTutorialGame(step) {
      const map = {
        id: 'tutorial',
        name: '教学场',
        description: '教学专用，不进入备战列表。',
        cells: PRACTICE_CELLS.join(''),
        unlockWins: 0,
        bridgeCells: new Set(),
        playerStart: { x: 2, y: 5 }, // C06
        cpuStartX: 10,               // K06 column
      };
      return {
        board: parseBoard(step.board, step.charged),
        map,
        difficulty: DIFFICULTIES[0], // display only; tutorial never reads AI fields
        round: step.round,
        finished: false, // step 6 becomes true via resolveTurn (round === ROUNDS)
        mulliganUsed: { player: true, cpu: true },
        players: {
          player: { hand: HAND_IDS.map((id) => CARDS.find((c) => c.id === id)), pile: [], sp: step.sp.player },
          cpu: { hand: HAND_IDS.map((id) => CARDS.find((c) => c.id === id)), pile: [], sp: step.sp.cpu },
        },
        tutorial: true,
        tutorialStep: step.id,
      };
    }

    // ------------------------------------------------------------------
    // Pure runner for tests (no DOM): fresh game -> validate both moves
    // with inspectMove -> resolveTurn -> score. Returns everything the
    // assertions need, including the post-turn board rendered back to
    // symbols so failures are reproducible at a glance.
    // ------------------------------------------------------------------
    // Debug rendering back to board symbols. Cores always render uppercase
    // (charged state is reported separately, so `p`/`c` stay unambiguous).
    function renderBoardSymbols(board) {
      const out = [];
      for (let y = 0; y < ROWS; y += 1) {
        let row = '';
        for (let x = 0; x < COLS; x += 1) {
          const tile = board[y * COLS + x];
          if (tile.kind === 'wall') row += '#';
          else if (tile.kind === 'clash') row += 'X';
          else if (tile.kind === 'core') row += tile.owner === 'player' ? 'P' : 'C';
          else if (tile.kind === 'ink') row += tile.owner === 'player' ? 'p' : 'c';
          else row += '.';
        }
        out.push(row);
      }
      return out;
    }

    function runTutorialStep(step) {
      const game = createTutorialGame(step);
      const before = rules.score(game.board);
      const moves = { player: { ...step.player }, cpu: { ...step.cpu } };
      const playerPlan = rules.inspectMove(game, 'player', moves.player);
      const cpuPlan = rules.inspectMove(game, 'cpu', moves.cpu);
      if (playerPlan.error || cpuPlan.error) {
        return {
          step: step.id,
          ok: false,
          playerError: playerPlan.error,
          cpuError: cpuPlan.error,
          playerCells: playerPlan.cells,
          cpuCells: cpuPlan.cells,
          board: renderBoardSymbols(game.board),
        };
      }
      const report = rules.resolveTurn(game, moves);
      const after = rules.score(game.board);
      const playerPlanOut = report.plans.find((p) => p.side === 'player');
      const cpuPlanOut = report.plans.find((p) => p.side === 'cpu');
      return {
        step: step.id,
        ok: true,
        score: after,
        before,
        sp: { player: game.players.player.sp, cpu: game.players.cpu.sp },
        collisions: report.collisions,
        blocked: report.blocked,
        charged: report.charged.map((index) => positionName({ x: index % COLS, y: Math.floor(index / COLS) })),
        finished: game.finished,
        captured: { player: playerPlanOut.captured, cpu: cpuPlanOut.captured },
        gained: { player: playerPlanOut.gained, cpu: cpuPlanOut.gained },
        painted: report.painted.map((index) => positionName({ x: index % COLS, y: Math.floor(index / COLS) })),
        board: renderBoardSymbols(game.board),
      };
    }

    return {
      TUTORIAL_KEY,
      TUTORIAL_STEPS,
      PRACTICE_CELLS,
      HAND_IDS,
      parseBoard,
      parsePosition,
      positionName,
      createTutorialGame,
      runTutorialStep,
      renderBoardSymbols,
    };
  }

  // Resolve the rules dependency: Node uses require; the browser uses the
  // global that rules.js already installed (load rules.js BEFORE tutorial.js).
  function resolveRules() {
    if (typeof window === 'object' && window.InkRules) return window.InkRules;
    if (typeof require === 'function') return require('./rules.js');
    throw new Error('InkRules not found — load rules.js before tutorial.js');
  }
  const exported = createInkTutorial(resolveRules());
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else window.InkTutorial = exported;
})();
