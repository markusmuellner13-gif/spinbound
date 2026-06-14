/* ============================================================
   SPINBOUND — game engine
   ============================================================ */
(() => {
  'use strict';

  const COLS = 5, ROWS = 4, CELLS = COLS * ROWS;
  const SPINS_PER_FLOOR = 5;
  // rent grows each floor; index 0 = floor 1
  const rentForFloor = (f) => Math.round(20 * Math.pow(1.6, f - 1) + (f - 1) * 8);

  const SAVE_KEY = 'spinbound.save.v1';

  /* ---------- DOM ---------- */
  const $ = (s) => document.querySelector(s);
  const screens = {
    title: $('#screen-title'), game: $('#screen-game'),
    shop: $('#screen-shop'), over: $('#screen-over'),
  };
  const el = {
    grid: $('#grid'), floatLayer: $('#float-layer'),
    floor: $('#hud-floor'), spins: $('#hud-spins'), rent: $('#hud-rent'), coins: $('#hud-coins'),
    rentFill: $('#rent-fill'), rentLabel: $('#rent-bar-label'),
    readout: $('#readout'), spinBtn: $('#btn-spin'),
    shopCards: $('#shop-cards'),
    overFloor: $('#over-floor'), overCoins: $('#over-coins'),
    overSub: $('#over-sub'), overRecord: $('#over-record'),
    toast: $('#toast'),
    statBestFloor: $('#stat-best-floor'), statBestCoins: $('#stat-best-coins'), statRuns: $('#stat-runs'),
    statDaily: $('#stat-daily'),
    lever: $('#lever'), coach: $('#coach'), mute: $('#btn-mute'),
    modeTag: $('#mode-tag'), bgFloat: $('#bg-float'),
  };

  /* ---------- persistent meta ---------- */
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
    catch { return {}; }
  }
  function saveMeta(m) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(m)); } catch {} }
  let meta = Object.assign(
    { bestFloor: 0, bestCoins: 0, runs: 0, muted: false, seenTutorial: false, daily: {} },
    loadMeta()
  );

  /* ---------- run state ---------- */
  let S = null;
  function newRun(mode) {
    const daily = mode === 'daily';
    rngFn = daily ? mulberry32(dailySeed()) : Math.random;
    S = {
      mode: daily ? 'daily' : 'normal',
      floor: 1,
      spinsLeft: SPINS_PER_FLOOR,
      coins: 0,
      rent: rentForFloor(1),
      bag: STARTER_BAG.map(cloneSym),
      banked: 0,           // total coins earned this run (for hoard etc.)
      bestPayout: 0,
      phoenixUsed: false,
      rerolls: 0,          // shop rerolls used this floor (price escalates)
      lastGrid: null,
      spinning: false,
    };
    meta.runs = (meta.runs || 0) + 1; saveMeta(meta);
  }

  function cloneSym(id) {
    const def = SYMBOLS[id];
    return Object.assign({}, def); // shallow clone so per-instance state (_growth, _age) is isolated
  }

  /* ---------- screen routing ---------- */
  function show(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  /* ---------- RNG (swappable for daily seed) ---------- */
  let rngFn = Math.random;
  const rng = () => rngFn();
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailyKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function dailySeed() {
    const s = dailyKey();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- sound (Web Audio, no asset files) + haptics ---------- */
  let audioCtx = null;
  function ac() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function tone(freq, dur, type, vol, when) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + (when || 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function sfx(name) {
    if (meta.muted) return;
    switch (name) {
      case 'tick':   tone(180 + rng() * 90, 0.05, 'square', 0.05); break;
      case 'spin':   for (let i = 0; i < 7; i++) tone(260 + i * 35, 0.05, 'square', 0.045, i * 0.05); break;
      case 'win':    [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.11, i * 0.05)); break;
      case 'bigwin': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, 'triangle', 0.13, i * 0.06)); break;
      case 'rent':   [392, 523, 659, 880].forEach((f, i) => tone(f, 0.18, 'sawtooth', 0.1, i * 0.07)); break;
      case 'evict':  [392, 294, 233, 175].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.13, i * 0.12)); break;
      case 'click':  tone(620, 0.05, 'square', 0.07); break;
      case 'buy':    tone(784, 0.08, 'triangle', 0.1); tone(1175, 0.1, 'triangle', 0.1, 0.06); break;
    }
  }
  function haptic(pattern) {
    if (meta.muted) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} }
  }

  /* ---------- grid fill ---------- */
  function rollGrid() {
    const grid = new Array(CELLS).fill(null);
    // sample bag into cells; if bag smaller than cells, leftover cells stay empty
    const picks = [];
    const bag = S.bag;
    for (let i = 0; i < CELLS; i++) {
      if (bag.length === 0) break;
      picks.push(bag[Math.floor(rng() * bag.length)]);
    }
    // place picks into random distinct cells
    const order = shuffle([...Array(CELLS).keys()]);
    picks.forEach((sym, i) => {
      const idx = order[i];
      grid[idx] = { sym, r: Math.floor(idx / COLS), c: idx % COLS, idx };
    });
    return grid;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- scoring ---------- */
  function scoreGrid(grid) {
    const cellAt = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS) ? null : grid[r * COLS + c];
    const destroyed = new Set();
    const events = []; // {idx, text, kind}
    let total = 0;
    let globalMult = 1;
    const consumed = []; // syms to remove from bag permanently

    const baseCtx = {
      grid, cols: COLS, rows: ROWS, rng, cellAt,
      bankedCoins: S.banked,
      countId(id) { return grid.filter(c => c && c.sym.id === id && !destroyed.has(c.idx)).length; },
    };

    // 1) grid-level effects (jackpot row, etc.)
    grid.forEach(cell => {
      if (!cell || !cell.sym.onGrid) return;
      const res = cell.sym.onGrid(baseCtx);
      if (res && res.globalMult) {
        globalMult *= res.globalMult;
        events.push({ idx: cell.idx, text: res.note || '×' + res.globalMult, kind: 'mult' });
      }
    });

    // 2) aura effects — set _mult / _bonus flags on neighbours before scoring
    grid.forEach(cell => {
      if (!cell || !cell.sym.onAura || destroyed.has(cell.idx)) return;
      cell.sym.onAura(makeCtx(cell));
    });

    // 3) normal scoring
    grid.forEach(cell => {
      if (!cell || destroyed.has(cell.idx) || !cell.sym.onScore) return;
      const ctx = makeCtx(cell);
      cell._pay = 0;
      cell.sym.onScore(ctx);
      let pay = (cell._pay + (cell._bonus || 0)) * (cell._mult || 1);
      if (pay !== 0) {
        total += pay;
        events.push({ idx: cell.idx, text: '+' + pay, kind: 'pay' });
      }
    });

    total = Math.round(total * globalMult);

    function makeCtx(cell) {
      return {
        self: cell, grid, cols: COLS, rows: ROWS, rng, cellAt,
        bankedCoins: S.banked,
        countId: baseCtx.countId,
        neighbours() {
          const out = [];
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const n = cellAt(cell.r + dr, cell.c + dc);
              if (n && !destroyed.has(n.idx)) out.push(n);
            }
          return out;
        },
        add(n, note) {
          cell._pay = (cell._pay || 0) + n;
          if (note) events.push({ idx: cell.idx, text: note, kind: 'note' });
        },
        note(text) { events.push({ idx: cell.idx, text, kind: 'note' }); },
        mult(x) { cell._mult = (cell._mult || 1) * x; },
        destroy(target) {
          destroyed.add(target.idx);
          events.push({ idx: target.idx, text: '💥', kind: 'destroy' });
          return target.sym;
        },
        consumeFromBag(sym) { consumed.push(sym); },
        addToBag(id) { S.bag.push(cloneSym(id)); },
      };
    }

    return { total, events, destroyed, consumed, globalMult };
  }

  /* ---------- rendering ---------- */
  function renderGrid(grid, scoreData) {
    el.grid.innerHTML = '';
    for (let i = 0; i < CELLS; i++) {
      const cell = grid[i];
      const div = document.createElement('div');
      div.className = 'cell';
      div.dataset.idx = i;
      if (cell) {
        div.textContent = cell.sym.emoji;
        div.classList.add('filled', `r-${cell.sym.rarity}`);
        if (scoreData && scoreData.destroyed.has(i)) div.classList.add('destroyed');
      } else {
        div.classList.add('empty');
      }
      el.grid.appendChild(div);
    }
  }

  function popFloats(events) {
    // group by idx so multiple notes stack
    const cells = el.grid.querySelectorAll('.cell');
    events.forEach((ev, k) => {
      const target = cells[ev.idx];
      if (!target) return;
      setTimeout(() => {
        const f = document.createElement('div');
        f.className = 'float float-' + ev.kind;
        f.textContent = ev.text;
        const rect = target.getBoundingClientRect();
        const wrap = el.floatLayer.getBoundingClientRect();
        f.style.left = (rect.left - wrap.left + rect.width / 2) + 'px';
        f.style.top = (rect.top - wrap.top + rect.height / 2) + 'px';
        el.floatLayer.appendChild(f);
        if (ev.kind === 'pay') { target.classList.add('hit'); setTimeout(() => target.classList.remove('hit'), 350); }
        setTimeout(() => f.remove(), 1100);
      }, 120 + k * 55);
    });
  }

  /* ---------- HUD ---------- */
  function syncHUD() {
    el.floor.textContent = S.floor;
    el.spins.textContent = S.spinsLeft;
    el.rent.textContent = S.rent;
    el.coins.textContent = S.coins;
    const pct = Math.min(100, (S.coins / S.rent) * 100);
    el.rentFill.style.width = pct + '%';
    el.rentFill.classList.toggle('ready', S.coins >= S.rent);
    el.rentLabel.textContent = `${S.coins} / ${S.rent}`;
  }

  /* ---------- the spin ---------- */
  function pullLever() {
    el.lever.classList.remove('pulled'); void el.lever.offsetWidth; el.lever.classList.add('pulled');
  }

  async function doSpin() {
    if (S.spinning || S.spinsLeft <= 0) return;
    hideCoach();
    S.spinning = true;
    el.spinBtn.disabled = true;
    el.readout.textContent = 'Spinning…';
    pullLever();
    sfx('spin'); haptic(30);

    // animate a few random frames
    for (let f = 0; f < 7; f++) {
      renderGrid(rollGrid());
      el.grid.classList.add('rolling');
      await wait(45 + f * 8);
    }
    el.grid.classList.remove('rolling');

    const grid = rollGrid();
    S.lastGrid = grid;
    const result = scoreGrid(grid);
    renderGrid(grid, result);
    popFloats(result.events);
    result.events.filter(e => e.kind === 'pay').slice(0, 14)
      .forEach((e, i) => setTimeout(() => sfx('tick'), 140 + i * 55));

    await wait(150 + Math.min(result.events.length, 18) * 55 + 250);

    S.coins += result.total;
    S.banked += Math.max(0, result.total);
    S.bestPayout = Math.max(S.bestPayout, result.total);
    meta.bestCoins = Math.max(meta.bestCoins || 0, result.total);

    // permanently remove consumed symbols (e.g. chest) from bag
    result.consumed.forEach(sym => {
      const i = S.bag.indexOf(sym);
      if (i >= 0) S.bag.splice(i, 1);
    });

    S.spinsLeft--;
    syncHUD();
    bumpCoins();

    if (result.total >= 40 || result.globalMult > 1) { sfx('bigwin'); haptic([0, 40, 40, 80]); }
    else if (result.total > 0) { sfx('win'); haptic(20); }

    el.readout.textContent = result.total > 0
      ? `+${result.total} coins!` + (result.globalMult > 1 ? `  (×${result.globalMult})` : '')
      : 'No win this spin.';

    // urgency hint when rent is close and spins are running out
    if (S.spinsLeft > 0 && S.coins < S.rent) {
      const need = S.rent - S.coins;
      if (S.spinsLeft === 1) el.readout.textContent += `  ⚠ LAST SPIN — need ${need} more!`;
      else el.readout.textContent += `  · ${need} to go in ${S.spinsLeft} spins`;
    }

    saveMeta(meta);

    // rent due?
    if (S.spinsLeft <= 0) {
      await wait(600);
      resolveRent();
    } else {
      S.spinning = false;
      el.spinBtn.disabled = false;
    }
  }

  function resolveRent() {
    if (S.coins >= S.rent) {
      S.coins -= S.rent;
      syncHUD();
      sfx('rent'); haptic([0, 30, 30, 30]);
      toast(`Rent paid! Floor ${S.floor} cleared.`);
      openShop();
    } else {
      // eviction — unless phoenix
      const hasPhoenix = S.bag.some(s => s.id === 'phoenix');
      if (hasPhoenix && !S.phoenixUsed) {
        S.phoenixUsed = true;
        // rent forgiven this once — keep current coins, advance
        sfx('bigwin'); haptic([0, 60, 40, 60]);
        toast('🔥 Phoenix revives you! Rent forgiven.');
        openShop();
      } else {
        gameOver();
      }
    }
  }

  /* ---------- shop ---------- */
  function rollShopChoices(n) {
    const ids = Object.keys(SYMBOLS);
    const pool = [];
    ids.forEach(id => {
      const w = RARITY_WEIGHT[SYMBOLS[id].rarity] || 1;
      for (let i = 0; i < w * 2; i++) pool.push(id);
    });
    const chosen = [];
    while (chosen.length < n && pool.length) {
      const pick = pool[Math.floor(rng() * pool.length)];
      if (!chosen.includes(pick)) chosen.push(pick);
    }
    return chosen;
  }

  function rerollCost() { return 3 + S.rerolls * 3; }

  function renderShop(choices) {
    el.shopCards.innerHTML = '';
    choices.forEach(id => {
      const def = SYMBOLS[id];
      const card = document.createElement('button');
      card.className = `shop-card r-${def.rarity}`;
      card.style.setProperty('--rc', RARITY_COLOR[def.rarity]);
      card.innerHTML = `
        <div class="sc-emoji">${def.emoji}</div>
        <div class="sc-name">${def.name}</div>
        <div class="sc-rarity">${def.rarity}</div>
        <div class="sc-desc">${def.desc}</div>
        <div class="sc-take">+ ADD TO BAG</div>`;
      card.addEventListener('click', () => {
        S.bag.push(cloneSym(id));
        sfx('buy'); haptic(25);
        toast(`${def.emoji} ${def.name} added to your bag.`);
        nextFloor();
      });
      el.shopCards.appendChild(card);
    });
    syncShopButtons();
  }

  function syncShopButtons() {
    const cost = rerollCost();
    const btn = $('#btn-reroll');
    if (btn) {
      btn.textContent = `🎲 Reroll (${cost})`;
      btn.disabled = S.coins < cost;
    }
  }

  function openShop() {
    S.spinning = false;
    S.rerolls = 0;
    renderShop(rollShopChoices(3));
    show('shop');
  }

  function nextFloor() {
    S.floor++;
    S.spinsLeft = SPINS_PER_FLOOR;
    S.rent = rentForFloor(S.floor);
    syncHUD();
    el.readout.textContent = `Floor ${S.floor} — pay ${S.rent} within ${SPINS_PER_FLOOR} spins!`;
    renderGrid(new Array(CELLS).fill(null));
    el.spinBtn.disabled = false;
    show('game');
  }

  /* ---------- game over ---------- */
  function gameOver() {
    sfx('evict'); haptic([0, 80, 50, 80, 50, 120]);
    let record = false;
    if (S.floor > (meta.bestFloor || 0)) { meta.bestFloor = S.floor; record = true; }
    if (S.bestPayout > (meta.bestCoins || 0)) { meta.bestCoins = S.bestPayout; record = true; }
    if (S.mode === 'daily') {
      const k = dailyKey();
      if (!meta.daily || meta.daily.date !== k) meta.daily = { date: k, bestFloor: 0 };
      if (S.floor > meta.daily.bestFloor) meta.daily.bestFloor = S.floor;
    }
    saveMeta(meta);
    el.overFloor.textContent = S.floor;
    el.overCoins.textContent = S.bestPayout;
    el.overSub.textContent = `You needed ${S.rent} but had only ${S.coins}.`;
    el.overRecord.classList.toggle('hidden', !record);
    show('over');
  }

  /* ---------- coach (auto-dismiss info card) ---------- */
  let coachTimer;
  function showCoach(html, ms) {
    el.coach.innerHTML = html + '<div class="coach-tap">tap to dismiss</div>';
    el.coach.classList.remove('hidden');
    void el.coach.offsetWidth;
    el.coach.classList.add('show');
    clearTimeout(coachTimer);
    if (ms) coachTimer = setTimeout(hideCoach, ms);
  }
  function hideCoach() {
    clearTimeout(coachTimer);
    el.coach.classList.remove('show');
    setTimeout(() => el.coach.classList.add('hidden'), 350);
  }

  /* ---------- helpers ---------- */
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  function bumpCoins() {
    el.coins.classList.remove('bump'); void el.coins.offsetWidth; el.coins.classList.add('bump');
  }
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2200);
  }

  /* ---------- modal ---------- */
  const modal = $('#modal'), modalContent = $('#modal-content');
  function openModal(html) { modalContent.innerHTML = html; modal.classList.remove('hidden'); }
  function closeModal() { modal.classList.add('hidden'); }
  $('#modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  function showBag() {
    const counts = {};
    S.bag.forEach(s => counts[s.id] = (counts[s.id] || 0) + 1);
    const rows = Object.keys(counts).sort((a, b) =>
      RARITY_WEIGHT[SYMBOLS[b].rarity] - RARITY_WEIGHT[SYMBOLS[a].rarity]).map(id => {
      const d = SYMBOLS[id];
      return `<div class="bag-row r-${d.rarity}">
        <span class="br-emoji">${d.emoji}</span>
        <span class="br-name">${d.name} <b>×${counts[id]}</b></span>
        <span class="br-desc">${d.desc}</span></div>`;
    }).join('');
    openModal(`<h3 class="modal-h">YOUR BAG (${S.bag.length})</h3><div class="bag-list">${rows}</div>`);
  }

  function howToPlay() {
    openModal(`
      <h3 class="modal-h">HOW TO PLAY</h3>
      <div class="how">
        <p><b>SPINBOUND</b> is a roguelike slot machine. Every <b>${SPINS_PER_FLOOR} spins</b> you owe <b>rent</b> that climbs each floor. Bank enough coins to pay it or you're <b>evicted</b> — that ends the run.</p>
        <p>🎰 <b>Spin</b> (button or <b>pull the lever</b>) fills the 5×4 grid with random symbols from <b>your bag</b>. Symbols pay coins and combo off their neighbours.</p>
        <p>🛒 After clearing a floor, <b>draft a new symbol</b> into your bag — or 🎲 <b>reroll</b> the offer for coins, or skip for +5. Stack synergies to build an unstoppable machine.</p>
        <p>🧠 Think in combos: Multipliers ✖️ and Lightning ⚡ on Diamonds 💎, Midas 👑 buffing everything around it, Cats 🐱 hunting Mice 🐭, three Sevens 7️⃣, a Jackpot 🎰 row…</p>
        <p>🗓 <b>Daily Seed</b> gives everyone the same symbols & shops for the day — compete for the deepest floor.</p>
        <p class="how-note">Coins are play-money. They have no real-world value and cannot be cashed out. This is a game of skill and luck, not real-money gambling.</p>
      </div>`);
  }

  /* ---------- title stats ---------- */
  function syncTitle() {
    el.statBestFloor.textContent = meta.bestFloor || '—';
    el.statBestCoins.textContent = meta.bestCoins || '—';
    el.statRuns.textContent = meta.runs || 0;
    if (el.statDaily) {
      const d = meta.daily && meta.daily.date === dailyKey() ? meta.daily.bestFloor : 0;
      el.statDaily.textContent = d ? `F${d}` : '—';
    }
  }

  /* ---------- mute ---------- */
  function syncMute() {
    el.mute.textContent = meta.muted ? '🔇' : '🔊';
    el.mute.classList.toggle('muted', meta.muted);
  }

  /* ---------- background floaters ---------- */
  function buildBackground() {
    if (!el.bgFloat) return;
    const glyphs = ['🍒', '🪙', '💎', '🍀', '7️⃣', '🔔', '⭐', '🎰', '👑'];
    const n = 14;
    let html = '';
    for (let i = 0; i < n; i++) {
      const g = glyphs[Math.floor(Math.random() * glyphs.length)];
      const left = Math.random() * 100;
      const dur = 14 + Math.random() * 16;
      const delay = -Math.random() * dur;
      const size = 18 + Math.random() * 28;
      html += `<span class="floater" style="left:${left}%;font-size:${size}px;animation-duration:${dur}s;animation-delay:${delay}s">${g}</span>`;
    }
    el.bgFloat.innerHTML = html;
  }

  /* ---------- wire up ---------- */
  $('#btn-play').addEventListener('click', () => startRun('normal'));
  $('#btn-daily').addEventListener('click', () => startRun('daily'));
  $('#btn-retry').addEventListener('click', () => startRun(S ? S.mode : 'normal'));
  $('#btn-home').addEventListener('click', () => { sfx('click'); syncTitle(); show('title'); });
  $('#btn-how').addEventListener('click', () => { sfx('click'); howToPlay(); });
  $('#btn-spin').addEventListener('click', doSpin);
  $('#btn-bag').addEventListener('click', () => { sfx('click'); showBag(); });
  $('#btn-skip').addEventListener('click', () => {
    S.coins += 5; sfx('buy'); haptic(20); toast('Skipped — +5 coins.'); nextFloor();
  });
  $('#btn-reroll').addEventListener('click', () => {
    const cost = rerollCost();
    if (S.coins < cost) return;
    S.coins -= cost; S.rerolls++;
    sfx('click'); haptic(15);
    renderShop(rollShopChoices(3));
    toast(`Rerolled for ${cost} coins.`);
  });
  el.mute.addEventListener('click', () => {
    meta.muted = !meta.muted; saveMeta(meta); syncMute();
    if (!meta.muted) sfx('click');
  });
  el.lever.addEventListener('click', doSpin);
  el.coach.addEventListener('click', hideCoach);

  function startRun(mode) {
    sfx('click');
    newRun(mode);
    syncHUD(); syncMute();
    el.modeTag.textContent = S.mode === 'daily' ? `🗓 DAILY · ${dailyKey()}` : '';
    el.modeTag.classList.toggle('hidden', S.mode !== 'daily');
    renderGrid(new Array(CELLS).fill(null));
    el.readout.textContent = `Floor 1 — pay ${S.rent} coins within ${SPINS_PER_FLOOR} spins!`;
    el.spinBtn.disabled = false;
    show('game');

    // onboarding coach: full tutorial first time, short reminder afterwards
    if (!meta.seenTutorial) {
      showCoach(
        `<div class="coach-h">🎯 HOW TO WIN</div>
         <p>Hit <b>SPIN</b> (or pull the lever ➡) to fill the grid from <b>your bag</b>.</p>
         <p>Symbols pay 🪙 coins and <b>combo with their neighbours</b>.</p>
         <p>Every <b>${SPINS_PER_FLOOR} spins</b> you owe <b>RENT</b> (top bar). Miss it and you're evicted!</p>
         <p>Clear a floor → <b>draft a new symbol</b> and build a synergy machine.</p>`,
        12000
      );
      meta.seenTutorial = true; saveMeta(meta);
    } else {
      showCoach(
        `<div class="coach-h">🎯 Floor 1</div>
         <p>Bank <b>${S.rent} coins</b> in <b>${SPINS_PER_FLOOR} spins</b> to pay rent.</p>`,
        5000
      );
    }
  }

  /* ---------- boot ---------- */
  buildBackground();
  syncTitle();
  syncMute();
  show('title');
})();
