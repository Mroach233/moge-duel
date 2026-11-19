(function () {
  'use strict';

  const { MAPS, DIFFICULTIES, CARDS, STARTER, DECK_SIZE } = window.InkRules;
  const LOADOUT_KEY = 'ink-duel-loadout-v1';
  const WIN_PREFIX = 'ink-duel-victory-v1-';
  const STARTER_IDS = STARTER.map(({ id }) => id);
  const rewards = [
    ...CARDS.map(({ name, unlockWins }) => ({ type: '卡牌', name, unlockWins })),
    ...MAPS.map(({ name, unlockWins }) => ({ type: '地图', name, unlockWins })),
    ...DIFFICULTIES.map(({ name, unlockWins }) => ({ type: '难度', name, unlockWins })),
  ].filter(({ unlockWins }) => unlockWins > 0);
  const byId = (id) => document.getElementById(id);

  window.createInkSetup = function ({ startMatch, resumeMatch, cardMarkup }) {
    const view = byId('setup-view');
    const deckDialog = byId('deck-dialog');
    const deckCatalog = byId('deck-catalog');
    const startButton = byId('start-match');
    const resumeButton = byId('resume-match');
    let storedWins = 0;
    let sessionWins = 0;
    let draft;

    const totalWins = () => storedWins + sessionWins;
    const isUnlocked = ({ unlockWins }) => totalWins() >= unlockWins;
    function showStorageNote() {
      byId('storage-note').hidden = false;
    }

    function syncWins() {
      try {
        let wins = 0;
        for (let index = 0; index < localStorage.length; index += 1) {
          if (localStorage.key(index)?.startsWith(WIN_PREFIX)) wins += 1;
        }
        storedWins = Math.max(storedWins, wins);
      } catch {
        showStorageNote();
      }
    }

    function readLoadout() {
      let raw;
      try {
        raw = localStorage.getItem(LOADOUT_KEY);
      } catch {
        showStorageNote();
      }

      let saved;
      try {
        saved = JSON.parse(raw) ?? {};
      } catch {
        saved = {};
      }
      const owned = new Set(CARDS.filter(isUnlocked).map(({ id }) => id));
      const ids = Array.isArray(saved.customDeck) ? [...new Set(saved.customDeck.filter((id) => owned.has(id)))] : [];
      return {
        mapId: MAPS.find((map) => map.id === saved.mapId && isUnlocked(map))?.id ?? MAPS[0].id,
        difficultyId: DIFFICULTIES.find((level) => level.id === saved.difficultyId && isUnlocked(level))?.id ?? DIFFICULTIES[0].id,
        mode: saved.mode === 'custom' && ids.length === DECK_SIZE ? 'custom' : 'starter',
        customDeck: ids.length === DECK_SIZE ? ids : STARTER_IDS.slice(),
      };
    }

    function saveLoadout() {
      try {
        localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
      } catch {
        showStorageNote();
      }
    }

    syncWins();
    const loadout = readLoadout();

    function makeOptions(containerId, options, key, preview = () => '') {
      const container = byId(containerId);
      return options.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button setup-choice';
        button.dataset.option = item.id;
        const requirement = item.unlockWins ? `${item.unlockWins} 胜解锁` : '';
        button.innerHTML = `${preview(item)}<strong>${item.name}</strong><span class="unlock-requirement">${requirement}</span>`;
        button.addEventListener('click', () => {
          loadout[key] = item.id;
          saveLoadout();
          renderSetup();
        });
        container.append(button);
        return button;
      });
    }

    const mapButtons = makeOptions('map-options', MAPS, 'mapId', ({ cells }) => {
      const classes = { '#': 'wall', P: 'player', C: 'cpu', B: 'bridge-point' };
      return `<span class="map-preview" aria-hidden="true">${Array.from(cells, (symbol) => (
        `<i class="${classes[symbol] ?? 'open'}"></i>`
      )).join('')}</span>`;
    });
    const difficultyButtons = makeOptions('difficulty-options', DIFFICULTIES, 'difficultyId');

    const catalogButtons = CARDS.map((card) => {
      const button = document.createElement('button');
      button.className = 'card catalog-card';
      button.type = 'button';
      button.dataset.card = card.id;
      button.innerHTML = cardMarkup(card, 0, '<span class="catalog-check" aria-hidden="true">✓</span>');
      if (card.unlockWins) {
        button.insertAdjacentHTML('beforeend', `<span class="catalog-lock" aria-hidden="true">${card.unlockWins} 胜解锁</span>`);
      }
      button.addEventListener('click', () => {
        if (!isUnlocked(card)) return;
        if (!draft.delete(card.id)) {
          if (draft.size >= DECK_SIZE) {
            renderDeck('已选满 15 张。移出一张才能换牌。');
            return;
          }
          draft.add(card.id);
        }
        renderDeck();
      });
      deckCatalog.append(button);
      return button;
    });

    function renderOptions(options, buttons, selected) {
      for (const [index, item] of options.entries()) {
        const button = buttons[index];
        const unlocked = isUnlocked(item);
        button.disabled = !unlocked;
        button.setAttribute('aria-pressed', item.id === selected);
        button.querySelector('.unlock-requirement').hidden = unlocked;
      }
    }

    function renderSetup() {
      const wins = totalWins();
      byId('win-count').textContent = wins;
      const next = rewards.filter(({ unlockWins }) => unlockWins === wins + 1);
      byId('next-unlock').textContent = next.length
        ? `下一胜解锁 ${next.map(({ name }) => name).join('、')}`
        : '已解锁全部内容';

      renderOptions(MAPS, mapButtons, loadout.mapId);
      renderOptions(DIFFICULTIES, difficultyButtons, loadout.difficultyId);
      byId('map-count').textContent = `${MAPS.filter(isUnlocked).length} / ${MAPS.length} 已开放`;
      byId('map-description').textContent = MAPS.find(({ id }) => id === loadout.mapId).description;
      byId('difficulty-description').textContent = DIFFICULTIES.find(({ id }) => id === loadout.difficultyId).description;
      byId('starter-deck').setAttribute('aria-pressed', loadout.mode === 'starter');
      byId('custom-deck').setAttribute('aria-pressed', loadout.mode === 'custom');
      byId('custom-deck-note').textContent = loadout.mode === 'custom' ? '已选 15 张 · 点击编辑' : '从卡库选 15 张';
    }

    function renderDeck(feedback) {
      const missing = DECK_SIZE - draft.size;
      byId('picked-count').textContent = `${draft.size} / ${DECK_SIZE}`;
      byId('deck-feedback').textContent = feedback ?? (missing ? `还需选择 ${missing} 张。` : '可以出战。');
      byId('clear-deck').disabled = !draft.size;
      byId('save-deck').disabled = missing !== 0;
      for (const [index, card] of CARDS.entries()) {
        const button = catalogButtons[index];
        const unlocked = isUnlocked(card);
        button.setAttribute('aria-pressed', draft.has(card.id));
        button.setAttribute('aria-label', unlocked
          ? `${card.name}，${card.size} 格，特殊攻击消耗 ${card.cost} SP`
          : `${card.name}，累计 ${card.unlockWins} 胜解锁`);
        button.disabled = !unlocked;
      }
    }

    function show(hasMatch) {
      syncWins();
      renderSetup();
      view.hidden = false;
      resumeButton.hidden = !hasMatch;
      startButton.firstElementChild.textContent = hasMatch ? '开始新对局' : '开始对局';
      byId('setup-title').focus({ preventScroll: true });
    }

    function awardVictory() {
      syncWins();
      const previous = totalWins();
      // Separate records preserve wins when the same save is open in two tabs.
      try {
        const id = crypto.getRandomValues(new Uint32Array(4)).join('-');
        localStorage.setItem(WIN_PREFIX + id, '1');
        storedWins += 1;
        syncWins();
      } catch {
        sessionWins += 1;
        showStorageNote();
      }
      return rewards.filter(({ unlockWins }) => previous < unlockWins && unlockWins <= totalWins());
    }

    // Current loadout as a startGame config — used by the tutorial's
    // replay path so "再看教学" finishes into the player's own choices.
    function getLoadout() {
      const { mapId, difficultyId, mode, customDeck } = loadout;
      return { mapId, difficultyId, deckIds: mode === 'custom' ? customDeck.slice() : null };
    }

    byId('starter-deck').addEventListener('click', () => {
      loadout.mode = 'starter';
      saveLoadout();
      renderSetup();
    });
    byId('custom-deck').addEventListener('click', () => {
      draft = new Set(loadout.customDeck);
      renderDeck();
      deckDialog.showModal();
      deckCatalog.scrollTop = 0;
    });
    byId('clear-deck').addEventListener('click', () => {
      draft.clear();
      renderDeck();
    });
    byId('save-deck').addEventListener('click', () => {
      if (draft.size !== DECK_SIZE) return;
      loadout.mode = 'custom';
      loadout.customDeck = [...draft];
      saveLoadout();
      renderSetup();
      deckDialog.close();
    });
    startButton.addEventListener('click', () => {
      const { mapId, difficultyId, mode, customDeck } = loadout;
      startMatch({ mapId, difficultyId, deckIds: mode === 'custom' ? customDeck.slice() : null });
    });
    resumeButton.addEventListener('click', resumeMatch);
    window.addEventListener('storage', (event) => {
      if (!event.key?.startsWith(WIN_PREFIX)) return;
      syncWins();
      renderSetup();
      if (deckDialog.open) renderDeck();
    });

    renderSetup();
    return { show, awardVictory, getLoadout };
  };
})();
