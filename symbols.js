/* ============================================================
   SPINBOUND — symbol definitions
   ------------------------------------------------------------
   Each symbol is data-driven. During scoring, every symbol on
   the grid gets an onScore(ctx) call. ctx exposes helpers so
   symbols can react to their neighbours and the whole grid.

   ctx = {
     self,          // this cell {sym, r, c, idx}
     grid,          // flat array of cells (length 20), some null/empty
     cols, rows,
     add(n, note),  // add n coins to THIS symbol's payout (note shows a popup)
     mult(x),       // multiply this symbol's running payout by x
     neighbours(),  // array of orthogonally+diagonally adjacent cells
     countId(id),   // how many of symbol `id` are on the grid
     rng,           // seeded-ish random in [0,1)
     destroy(cell), // remove a cell from the grid this spin (returns its sym)
     addToBag(id),  // permanently add a symbol to the player's bag
   }

   rarity: common | uncommon | rare | legend  (drives shop odds + price)
   ============================================================ */

const SYMBOLS = {
  /* ---------- COMMONS ---------- */
  cherry: {
    id: 'cherry', name: 'Cherry', emoji: '🍒', rarity: 'common', base: 1,
    desc: 'Pays 1. +1 more for every other Cherry on the grid.',
    onScore(ctx) {
      ctx.add(1);
      const extra = ctx.countId('cherry') - 1;
      if (extra > 0) ctx.add(extra, `+${extra} cherries`);
    },
  },
  coin: {
    id: 'coin', name: 'Coin', emoji: '🪙', rarity: 'common', base: 2,
    desc: 'Pays 2. Reliable money.',
    onScore(ctx) { ctx.add(2); },
  },
  clover: {
    id: 'clover', name: 'Clover', emoji: '🍀', rarity: 'common', base: 1,
    desc: 'Pays 1. 25% chance to pay 6 instead.',
    onScore(ctx) {
      if (ctx.rng() < 0.25) ctx.add(6, 'lucky!');
      else ctx.add(1);
    },
  },
  bell: {
    id: 'bell', name: 'Bell', emoji: '🔔', rarity: 'common', base: 2,
    desc: 'Pays 2. +3 if next to another Bell.',
    onScore(ctx) {
      ctx.add(2);
      if (ctx.neighbours().some(n => n.sym.id === 'bell')) ctx.add(3, 'ring!');
    },
  },
  lemon: {
    id: 'lemon', name: 'Lemon', emoji: '🍋', rarity: 'common', base: 1,
    desc: 'Pays 1. Pays 3 if it lands on the bottom row.',
    onScore(ctx) {
      if (ctx.self.r === ctx.rows - 1) ctx.add(3, 'ripe');
      else ctx.add(1);
    },
  },

  /* ---------- UNCOMMONS ---------- */
  seven: {
    id: 'seven', name: 'Lucky Seven', emoji: '7️⃣', rarity: 'uncommon', base: 3,
    desc: 'Pays 3. Three or more Sevens anywhere: each pays 11 instead.',
    onScore(ctx) {
      ctx.add(ctx.countId('seven') >= 3 ? 11 : 3, ctx.countId('seven') >= 3 ? '777!' : '');
    },
  },
  cat: {
    id: 'cat', name: 'Cat', emoji: '🐱', rarity: 'uncommon', base: 1,
    desc: 'Pays 1. Destroys an adjacent Mouse to pay +10.',
    onScore(ctx) {
      ctx.add(1);
      const mouse = ctx.neighbours().find(n => n.sym.id === 'mouse');
      if (mouse) { ctx.destroy(mouse); ctx.add(10, 'pounce!'); }
    },
  },
  mouse: {
    id: 'mouse', name: 'Mouse', emoji: '🐭', rarity: 'uncommon', base: 2,
    desc: 'Pays 2. Risky snack — Cats love it.',
    onScore(ctx) { ctx.add(2); },
  },
  bomb: {
    id: 'bomb', name: 'Bomb', emoji: '💣', rarity: 'uncommon', base: 0,
    desc: 'Destroys all adjacent symbols. Pays 4 for each one destroyed.',
    onScore(ctx) {
      let n = 0;
      ctx.neighbours().forEach(c => { ctx.destroy(c); n++; });
      if (n) ctx.add(n * 4, `boom x${n}`);
    },
  },
  diamond: {
    id: 'diamond', name: 'Diamond', emoji: '💎', rarity: 'uncommon', base: 5,
    desc: 'Pays 5. +2 for every Diamond adjacent to it.',
    onScore(ctx) {
      ctx.add(5);
      const adj = ctx.neighbours().filter(n => n.sym.id === 'diamond').length;
      if (adj) ctx.add(adj * 2, 'facets');
    },
  },
  magnet: {
    id: 'magnet', name: 'Magnet', emoji: '🧲', rarity: 'uncommon', base: 1,
    desc: 'Pays 1. +3 for each adjacent Coin or Diamond.',
    onScore(ctx) {
      ctx.add(1);
      const adj = ctx.neighbours().filter(n => n.sym.id === 'coin' || n.sym.id === 'diamond').length;
      if (adj) ctx.add(adj * 3, 'attract');
    },
  },
  spider: {
    id: 'spider', name: 'Spider', emoji: '🕷️', rarity: 'uncommon', base: 1,
    desc: 'Pays 1. +2 for each adjacent symbol (it spins a web).',
    onScore(ctx) {
      ctx.add(1);
      const adj = ctx.neighbours().length;
      if (adj) ctx.add(adj * 2, 'web');
    },
  },

  /* ---------- RARES ---------- */
  wild: {
    id: 'wild', name: 'Wildcard', emoji: '🌟', rarity: 'rare', base: 4,
    desc: 'Pays 4, then copies the payout of one random neighbour.',
    onScore(ctx) {
      ctx.add(4);
      const ns = ctx.neighbours();
      if (ns.length) {
        const pick = ns[Math.floor(ctx.rng() * ns.length)];
        ctx.add(Math.max(1, pick.sym.base), `copy ${pick.sym.emoji}`);
      }
    },
  },
  multiplier: {
    id: 'multiplier', name: 'Multiplier', emoji: '✖️', rarity: 'rare', base: 0,
    desc: 'Pays nothing alone, but DOUBLES the payout of every adjacent symbol.',
    onAura(ctx) {
      ctx.neighbours().forEach(c => c._mult = (c._mult || 1) * 2);
    },
  },
  gift: {
    id: 'gift', name: 'Gift Box', emoji: '🎁', rarity: 'rare', base: 2,
    desc: 'Pays 2. 25% chance to permanently drop a free Coin into your bag.',
    onScore(ctx) {
      ctx.add(2);
      if (ctx.rng() < 0.25) { ctx.addToBag('coin'); ctx.note('🪙 +bag'); }
    },
  },
  hoard: {
    id: 'hoard', name: 'Dragon Hoard', emoji: '🐉', rarity: 'rare', base: 3,
    desc: 'Pays 3 + 1 for every 5 coins you already banked this run.',
    onScore(ctx) {
      ctx.add(3);
      const bonus = Math.floor(ctx.bankedCoins / 5);
      if (bonus) ctx.add(bonus, 'hoard');
    },
  },
  rocket: {
    id: 'rocket', name: 'Rocket', emoji: '🚀', rarity: 'rare', base: 2,
    desc: 'Pays 2 and grows: permanently +1 base each time it pays.',
    onScore(ctx) {
      ctx.add(2 + (ctx.self.sym._growth || 0));
      ctx.self.sym._growth = (ctx.self.sym._growth || 0) + 1;
    },
  },
  chest: {
    id: 'chest', name: 'Treasure Chest', emoji: '🧰', rarity: 'rare', base: 0,
    desc: 'Pays 0 for 3 spins, then bursts for 30 coins and is consumed.',
    onScore(ctx) {
      ctx.self.sym._age = (ctx.self.sym._age || 0) + 1;
      if (ctx.self.sym._age >= 3) {
        ctx.add(30, 'jackpot!');
        ctx.consumeFromBag(ctx.self.sym);
      } else {
        ctx.add(0, `${3 - ctx.self.sym._age} left`);
      }
    },
  },

  /* ---------- LEGENDS ---------- */
  jackpot: {
    id: 'jackpot', name: 'JACKPOT', emoji: '🎰', rarity: 'legend', base: 7,
    desc: 'Pays 7. If three line up in any row, the whole grid pays DOUBLE.',
    onScore(ctx) {
      ctx.add(7);
      // global double handled by engine when 3 jackpots share a row
    },
    onGrid(ctx) {
      // check rows for 3 jackpots
      for (let r = 0; r < ctx.rows; r++) {
        let c = 0;
        for (let col = 0; col < ctx.cols; col++) {
          const cell = ctx.cellAt(r, col);
          if (cell && cell.sym.id === 'jackpot') c++;
        }
        if (c >= 3) return { globalMult: 2, note: 'JACKPOT ROW!' };
      }
      return null;
    },
  },
  phoenix: {
    id: 'phoenix', name: 'Phoenix', emoji: '🔥', rarity: 'legend', base: 6,
    desc: 'Pays 6. The first time you would be evicted each run, it revives you instead.',
    onScore(ctx) { ctx.add(6); },
    revive: true,
  },
  midas: {
    id: 'midas', name: 'Midas Touch', emoji: '👑', rarity: 'legend', base: 6,
    desc: 'Pays 6 AND gives +4 coins to every symbol touching it.',
    onAura(ctx) { ctx.neighbours().forEach(c => c._bonus = (c._bonus || 0) + 4); },
    onScore(ctx) { ctx.add(6); },
  },
  lightning: {
    id: 'lightning', name: 'Lightning', emoji: '⚡', rarity: 'legend', base: 2,
    desc: 'Pays 2 and TRIPLES the payout of one random neighbour.',
    onAura(ctx) {
      const ns = ctx.neighbours();
      if (ns.length) {
        const t = ns[Math.floor(ctx.rng() * ns.length)];
        t._mult = (t._mult || 1) * 3;
      }
    },
    onScore(ctx) { ctx.add(2); },
  },
  rainbow: {
    id: 'rainbow', name: 'Rainbow', emoji: '🌈', rarity: 'legend', base: 3,
    desc: 'Pays 3 for every different KIND of symbol on the grid at once.',
    onScore(ctx) {
      const kinds = new Set(ctx.grid.filter(c => c).map(c => c.sym.id)).size;
      ctx.add(kinds * 3, `${kinds} kinds`);
    },
  },
};

/* shop weights by rarity */
const RARITY_WEIGHT = { common: 60, uncommon: 30, rare: 9, legend: 1.5 };
const RARITY_COLOR  = { common: '#9fb2c9', uncommon: '#54d98c', rare: '#5b8dff', legend: '#ffb13d' };

/* the bag every run starts with */
const STARTER_BAG = ['cherry','cherry','cherry','coin','coin','clover','clover','bell','lemon'];

if (typeof module !== 'undefined') module.exports = { SYMBOLS, RARITY_WEIGHT, RARITY_COLOR, STARTER_BAG };
