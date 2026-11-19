(function () {
  'use strict';

  const ROWS = 11;
  const COLS = 13;
  const ROUNDS = 12;
  const DECK_SIZE = 15;
  const SIDES = ['player', 'cpu'];
  const NEIGHBORS = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ];

  const EMPTY = { kind: 'empty' };
  const WALL = { kind: 'wall' };
  const CLASH = { kind: 'clash' };

  function makeMap(id, name, description, rows, unlockWins = 0) {
    const cells = rows.join('');
    const start = cells.indexOf('P');
    const bridgeCells = new Set();
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] === 'B') bridgeCells.add(index);
    }
    return {
      id, name, description, cells, unlockWins, bridgeCells,
      playerStart: { x: start % COLS, y: Math.floor(start / COLS) },
      cpuStartX: cells.indexOf('C') % COLS,
    };
  }

  const MAPS = [
    makeMap('practice', '练习场', '中路开阔，两侧各有零散障碍。', [
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
    ]),
    makeMap('lanes', '双巷', '中墙隔开双方，只有上下两条路可以绕过去。', [
      '#...........#',
      '.............',
      '......#......',
      '......#......',
      '......#......',
      '..P...#...C..',
      '......#......',
      '......#......',
      '......#......',
      '.............',
      '#...........#',
    ]),
    makeMap('bridge', '窄桥', '占领中线的桥格，就能从它旁边发动特殊攻击。', [
      '##...###...##',
      '#....###....#',
      '.....###.....',
      '.....###.....',
      '......B......',
      '..P.......C..',
      '......B......',
      '.....###.....',
      '.....###.....',
      '#....###....#',
      '##...###...##',
    ]),
    makeMap('reef', '环礁', '从对角出发，沿中央礁石绕行。', [
      '##.........##',
      '#...........#',
      '..P..........',
      '.....###.....',
      '....#####....',
      '....#####....',
      '....#####....',
      '.....###.....',
      '..........C..',
      '#...........#',
      '##.........##',
    ], 1),
    makeMap('factory', '交错工厂', '交错的障碍把棋盘分成许多小空隙。', [
      '#...........#',
      '.......#.#...',
      '..P.......#..',
      '.....#.......',
      '.##....#.....',
      '....#...#....',
      '.....#....##.',
      '.......#.....',
      '..#.......C..',
      '...#.#.......',
      '#...........#',
    ], 3),
    makeMap('twins', '双子岛', '两块墨区只靠中央窄口相连，先占 G05/G07 的人先打到对面。', [
      '.....###.....',
      '.....###.....',
      '.....###.....',
      '.....###.....',
      '#.....B.....#',
      '..P.......C..',
      '#.....B.....#',
      '.....###.....',
      '.....###.....',
      '.....###.....',
      '.....###.....',
    ], 1),
  ];

  const DIFFICULTIES = [
    { id: 'rookie', name: '入门', description: '电脑先在自己一侧铺墨，末段才会反涂。', unlockWins: 0, advance: -0.32, variety: 11, attackRound: 10 },
    { id: 'standard', name: '标准', description: '电脑会主动争夺中线，中盘开始寻找反涂机会。', unlockWins: 2, advance: 0.38, variety: 1.5, attackRound: 6 },
    { id: 'expert', name: '高手', description: '电脑会更积极地向前压，有机会就反涂。', unlockWins: 4, advance: 0.65, variety: 0.25, attackRound: 1 },
  ];

  function makeCard(id, name, cost, pattern, unlockWins = 0) {
    let width = pattern[0].length;
    let height = pattern.length;
    let cells = pattern.flatMap((row, y) => Array.from(row).flatMap((symbol, x) => (
      symbol === '.' ? [] : [{ x, y, core: symbol === '@' }]
    )));
    const rotations = [];

    for (let turn = 0; turn < 4; turn += 1) {
      rotations.push({ cells, width, height });
      cells = cells.map(({ x, y, core }) => ({ x: height - 1 - y, y: x, core }));
      [width, height] = [height, width];
    }

    return { id, name, cost, unlockWins, size: rotations[0].cells.length, rotations };
  }

  const CARDS = [
    makeCard('roller', '宽滚', 3, ['####', '##@#']),
    makeCard('stairs', '阶梯', 3, ['##..', '.##.', '..@#']),
    makeCard('cross', '十字', 2, ['.#.', '#@#', '.#.']),
    makeCard('elbow', '折角', 1, ['@.', '##']),
    makeCard('beam', '长线', 2, ['####@']),
    makeCard('hook', '弯钩', 2, ['###', '@..', '#..']),
    makeCard('arch', '拱门', 3, ['###', '#.#', '@.#']),
    makeCard('crest', '浪峰', 3, ['#.#', '#.#', '###', '.@.']),
    makeCard('diamond', '菱印', 3, ['.#.', '###', '#@#', '.#.']),
    makeCard('square', '方印', 2, ['##', '#@']),
    makeCard('tide', '墨潮', 3, ['####', '####', '####']),
    makeCard('drop', '墨滴', 1, ['@']),
    makeCard('fishtail', '鱼尾', 3, ['#@.', '###', '..#']),
    makeCard('bridge', '曲桥', 3, ['####..', '...@##']),
    makeCard('short', '短线', 1, ['@##']),
    makeCard('spray', '散点', 1, ['#.@', '.#.']),
    makeCard('ramp', '斜坡', 3, ['.##', '###', '@..']),
    makeCard('stripe', '双列', 3, ['###', '#.#', '#@#']),
    makeCard('bracket', '夹角', 2, ['#.#', '#@#']),
    makeCard('stamp', '实心章', 4, ['###', '#@#', '###']),
    makeCard('blade', '潮刃', 4, ['#...', '###.', '##@#', '.##.'], 1),
    makeCard('spire', '尖塔', 2, ['..#', '..#', '#@#'], 2),
    makeCard('fan', '百叶', 3, ['#.#.', '####', '.#@.'], 3),
    makeCard('vortex', '涡心', 3, ['.##', '##@', '##.'], 4),
  ];
  const STARTER = CARDS.slice(0, DECK_SIZE);
  const cardsById = new Map(CARDS.map((card) => [card.id, card]));

  function createPlayer(deck, presetOpening, random) {
    const cards = deck.slice();
    const firstShuffled = presetOpening ? 4 : 0;
    for (let index = cards.length - 1; index > firstShuffled; index -= 1) {
      const other = firstShuffled + Math.floor(random() * (index - firstShuffled + 1));
      [cards[index], cards[other]] = [cards[other], cards[index]];
    }
    return { hand: cards.slice(0, 4), pile: cards.slice(4), sp: 0 };
  }

  function createGame(random = Math.random, {
    mapId = MAPS[0].id,
    difficultyId = DIFFICULTIES[0].id,
    deckIds = null,
    bridgeOrigins = true,
  } = {}) {
    const mapDefinition = MAPS.find(({ id }) => id === mapId);
    const difficulty = DIFFICULTIES.find(({ id }) => id === difficultyId);
    if (!mapDefinition || !difficulty) throw new RangeError('Unknown map or difficulty');
    const map = bridgeOrigins ? mapDefinition : { ...mapDefinition, bridgeCells: new Set() };
    if (deckIds !== null && !Array.isArray(deckIds)) throw new TypeError('Expected an array of card IDs');
    const deck = deckIds === null ? STARTER : Array.from(deckIds, (id) => cardsById.get(id));
    if (deck.length !== DECK_SIZE || deck.some((card) => !card) || new Set(deck).size !== DECK_SIZE) {
      throw new RangeError(`Choose ${DECK_SIZE} distinct cards`);
    }

    const board = Array.from(map.cells, (symbol) => {
      if (symbol === '#') return WALL;
      if (symbol === 'P' || symbol === 'C') {
        return { kind: 'core', owner: symbol === 'P' ? 'player' : 'cpu' };
      }
      return EMPTY;
    });
    return {
      board, map, difficulty,
      round: 1,
      finished: false,
      mulliganUsed: { player: false, cpu: false },
      players: { player: createPlayer(deck, deckIds === null, random), cpu: createPlayer(STARTER, true, random) },
    };
  }

  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  function tileAt(board, x, y) {
    return inBounds(x, y) ? board[y * COLS + x] : WALL;
  }

  function footprint(pose, x, y) {
    const left = x - Math.floor(pose.width / 2);
    const top = y - Math.floor(pose.height / 2);
    return pose.cells.map((cell) => ({ x: left + cell.x, y: top + cell.y, core: cell.core }));
  }

  function placementError({ board, map }, side, cells, attack) {
    let connected = false;
    for (const cell of cells) {
      if (!inBounds(cell.x, cell.y)) return 'bounds';
      const tile = tileAt(board, cell.x, cell.y);
      if (tile.kind === 'wall' || tile.kind === 'clash') return 'wall';
      if (tile.kind !== 'empty' && (!attack || tile.kind === 'core')) return 'occupied';

      if (!connected) {
        connected = NEIGHBORS.some(([dx, dy]) => {
          const x = cell.x + dx;
          const y = cell.y + dy;
          const neighbor = tileAt(board, x, y);
          return neighbor.owner === side && (
            !attack || neighbor.kind === 'core' || map.bridgeCells.has(y * COLS + x)
          );
        });
      }
    }
    return connected ? null : 'connection';
  }

  // UI metadata for a special attack: which footprint cells would flip enemy
  // ink, stay neutral, or are blocked, plus every own tile that can serve as
  // an origin (own core or own occupied bridge cell, 8-adjacent to the shape).
  // Reuses tileAt/inBounds so it can never disagree with placementError.
  function attackMeta(game, side, cells) {
    const { board, map } = game;
    const meta = { origins: [], flips: [], neutrals: [], blocked: [] };
    const originSeen = new Set();
    for (const cell of cells) {
      const tile = tileAt(board, cell.x, cell.y);
      if (!inBounds(cell.x, cell.y) || tile.kind === 'wall' || tile.kind === 'clash' || tile.kind === 'core') {
        meta.blocked.push({ x: cell.x, y: cell.y });
      } else if (tile.kind === 'ink' && tile.owner !== side) {
        meta.flips.push({ x: cell.x, y: cell.y });
      } else {
        meta.neutrals.push({ x: cell.x, y: cell.y });
      }
      for (const [dx, dy] of NEIGHBORS) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        const neighbor = tileAt(board, x, y);
        const index = y * COLS + x;
        if (!originSeen.has(index) && neighbor.owner === side
          && (neighbor.kind === 'core' || map.bridgeCells.has(index))) {
          originSeen.add(index);
          meta.origins.push({ x, y });
        }
      }
    }
    return meta;
  }

  // One-time opening mulligan (design 8.4): the old 4 cards go back to the
  // FRONT of the pile (farthest from the draw end) in their original order,
  // and the new hand is exactly the 4 cards that would have been drawn next.
  // No SP change, no discard gain, no reshuffle, pile stays DECK_SIZE - 4.
  // Fails once used or after round 1.
  function mulligan(game, side) {
    const player = game.players[side];
    if (game.finished || game.round !== 1 || game.mulliganUsed[side] || !player) return false;
    if (player.hand.length !== 4 || player.pile.length !== DECK_SIZE - 4) return false;
    game.mulliganUsed[side] = true;
    player.pile = [...player.hand, ...player.pile];
    player.hand = player.pile.splice(player.pile.length - 4, 4);
    return true;
  }

  // CPU opening-mulligan decision (design 8.4): score the best placement
  // for a given candidate hand with chooseCpuMove's gain/capture/cost/advance
  // terms (no random consumption, so fixed-seed trials stay reproducible).
  // inspectMove reads the side's actual hand, so the candidate is evaluated
  // through a shallow ghost clone — the real game is never mutated.
  function cpuHandBestScore(game, hand) {
    const { map, difficulty, round } = game;
    const { sp } = game.players.cpu;
    const ghost = {
      ...game,
      players: { ...game.players, cpu: { ...game.players.cpu, hand } },
    };
    let best = 0.5;
    for (const [slot, card] of hand.entries()) {
      const modes = sp >= card.cost && round >= difficulty.attackRound ? [false, true] : [false];
      for (const attack of modes) {
        for (const [rotation, pose] of card.rotations.entries()) {
          for (let top = 0; top <= ROWS - pose.height; top += 1) {
            for (let left = 0; left <= COLS - pose.width; left += 1) {
              const x = left + Math.floor(pose.width / 2);
              const y = top + Math.floor(pose.height / 2);
              const preview = inspectMove(ghost, 'cpu', { slot, rotation, x, y, attack });
              if (preview.error) continue;
              let gain = 0;
              let captures = 0;
              for (const cell of preview.cells) {
                const tile = tileAt(ghost.board, cell.x, cell.y);
                if (tile.kind === 'empty') gain += 1;
                if (tile.owner === 'player') captures += 1;
              }
              if (attack && captures === 0 && round < 10) continue;
              const advance = (map.cpuStartX - left) * difficulty.advance * (round <= 5 ? 1 : 0.35);
              const cost = attack ? card.cost * (round <= 9 ? 0.9 : 0.2) : 0;
              const score = gain + captures * 2 - cost + advance;
              if (score > best) best = score;
            }
          }
        }
      }
    }
    return best;
  }

  // True only when round 1, unused, unfinished, and the pile's last 4 cards
  // (the ones a swap would draw) score >= 0.5 above the current hand.
  function shouldCpuMulligan(game) {
    if (game.finished || game.round !== 1 || game.mulliganUsed.cpu) return false;
    const player = game.players.cpu;
    if (!player || player.hand.length !== 4) return false;
    const before = cpuHandBestScore(game, player.hand);
    const after = cpuHandBestScore(game, player.pile.slice(-4));
    return after >= before + 0.5;
  }

  function inspectMove(game, side, move) {
    const player = game.players[side];
    const card = player.hand[move.slot];
    if (game.finished || !card) return { cells: [], error: 'card', meta: null };
    if (move.pass) return { card, cells: [], error: null, meta: null };

    const pose = card.rotations[move.rotation];
    if (!pose || !Number.isInteger(move.x) || !Number.isInteger(move.y)) {
      return { card, cells: [], error: 'target', meta: null };
    }
    const cells = footprint(pose, move.x, move.y);
    const error = move.attack && player.sp < card.cost
      ? 'charge'
      : placementError(game, side, cells, move.attack);
    // Attack metadata is computed even for illegal moves so the UI can mark
    // the blocked/flipped cells while explaining the failure.
    return { card, cells, error, meta: move.attack ? attackMeta(game, side, cells) : null };
  }

  // Whether the card in `slot` has at least one legal placement for `side`:
  // 4 rotations x every anchor that keeps the whole shape on the board.
  // Every check delegates to inspectMove, so UI greying can never disagree
  // with what the engine accepts. Attack defaults to false — greying ignores
  // special attacks, whose availability depends on SP.
  function hasAnyPlacement(game, side, slot, { attack = false } = {}) {
    const player = game.players[side];
    const card = player && player.hand[slot];
    if (game.finished || !card) return false;
    for (const [rotation, pose] of card.rotations.entries()) {
      for (let top = 0; top <= ROWS - pose.height; top += 1) {
        for (let left = 0; left <= COLS - pose.width; left += 1) {
          const move = {
            slot,
            rotation,
            x: left + Math.floor(pose.width / 2),
            y: top + Math.floor(pose.height / 2),
            attack,
          };
          if (!inspectMove(game, side, move).error) return true;
        }
      }
    }
    return false;
  }

  function chooseCpuMove(game, random = Math.random) {
    const { board, round, map, difficulty } = game;
    const { hand, sp } = game.players.cpu;
    let best = { slot: 0, pass: true };
    let bestScore = 0.5;

    for (const [slot, card] of hand.entries()) {
      const preference = random() * difficulty.variety;
      const modes = sp >= card.cost && round >= difficulty.attackRound ? [false, true] : [false];
      for (const [rotation, pose] of card.rotations.entries()) {
        for (const attack of modes) {
          for (let top = 0; top <= ROWS - pose.height; top += 1) {
            for (let left = 0; left <= COLS - pose.width; left += 1) {
              const x = left + Math.floor(pose.width / 2);
              const y = top + Math.floor(pose.height / 2);
              const cells = footprint(pose, x, y);
              if (placementError(game, 'cpu', cells, attack)) continue;

              let gain = 0;
              let captures = 0;
              for (const cell of cells) {
                const tile = tileAt(board, cell.x, cell.y);
                if (tile.kind === 'empty') gain += 1;
                if (tile.owner === 'player') captures += 1;
              }
              if (attack && captures === 0 && round < 10) continue;

              const advance = (map.cpuStartX - left) * difficulty.advance * (round <= 5 ? 1 : 0.35);
              const cost = attack ? card.cost * (round <= 9 ? 0.9 : 0.2) : 0;
              const score = gain + captures * 2 - cost + advance + preference + random();
              if (score > bestScore) {
                best = { slot, rotation, x, y, attack };
                bestScore = score;
              }
            }
          }
        }
      }
    }
    return best;
  }

  function resolveTurn(game, moves) {
    const plans = SIDES.map((side) => {
      const move = moves[side];
      const plan = inspectMove(game, side, move);
      if (plan.error) throw new Error(`Invalid ${side} move: ${plan.error}`);
      return { ...plan, move, side, gained: 0, captured: 0 };
    });

    // Both moves are checked against the same board before either can paint.
    const proposals = new Map();
    for (const plan of plans) {
      for (const cell of plan.cells) {
        const index = cell.y * COLS + cell.x;
        if (!proposals.has(index)) proposals.set(index, []);
        proposals.get(index).push({ core: cell.core, plan });
      }
    }

    const board = game.board.slice();
    let collisions = 0;
    let blocked = 0;
    for (const [index, [first, second]] of proposals) {
      let winner = first;
      if (second) {
        collisions += 1;
        const priority = Number(first.core) - Number(second.core)
          || second.plan.card.size - first.plan.card.size;
        if (priority === 0) {
          board[index] = CLASH;
          blocked += 1;
          continue;
        }
        if (priority < 0) winner = second;
      }
      const { core, plan } = winner;
      if (board[index].owner && board[index].owner !== plan.side) plan.captured += 1;
      board[index] = { kind: core ? 'core' : 'ink', owner: plan.side };
    }

    const charged = [];
    for (const [index, tile] of board.entries()) {
      if (tile.kind !== 'core' || tile.charged) continue;
      const x = index % COLS;
      const y = Math.floor(index / COLS);
      const enclosed = NEIGHBORS.every(([dx, dy]) => tileAt(board, x + dx, y + dy).kind !== 'empty');
      if (enclosed) {
        board[index] = { ...tile, charged: true };
        charged.push(index);
        plans.find(({ side }) => side === tile.owner).gained += 1;
      }
    }

    for (const plan of plans) {
      const player = game.players[plan.side];
      if (plan.move.pass) plan.gained += 1;
      else if (plan.move.attack) player.sp -= plan.card.cost;
      player.sp += plan.gained;
      const replacement = player.pile.pop();
      player.hand.splice(plan.move.slot, 1, ...(replacement ? [replacement] : []));
    }

    const report = { round: game.round, plans, collisions, blocked, painted: [...proposals.keys()], charged };
    game.board = board;
    game.finished = game.round === ROUNDS;
    if (!game.finished) game.round += 1;
    return report;
  }

  function score(board) {
    const result = { player: 0, cpu: 0, playable: 0 };
    for (const tile of board) {
      if (tile.kind !== 'wall') result.playable += 1;
      if (tile.owner) result[tile.owner] += 1;
    }
    return result;
  }

  const rules = {
    ROWS, COLS, ROUNDS, DECK_SIZE, MAPS, DIFFICULTIES, CARDS, STARTER,
    createGame, score, chooseCpuMove, inspectMove, hasAnyPlacement, resolveTurn, inBounds,
    mulligan, cpuHandBestScore, shouldCpuMulligan,
  };
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else window.InkRules = rules;
})();
