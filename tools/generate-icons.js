/* Generates Spinbound app icons as real PNGs using only Node built-ins (zlib).
   Run: node tools/generate-icons.js  */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const pad = maskable ? size * 0.16 : size * 0.06; // safe zone for maskable
  const inner = size - pad * 2;
  const R = inner / 2;

  // palette
  const bgTop = [42, 31, 94], bgBot = [11, 10, 26];
  const gold = [255, 210, 74], pink = [255, 77, 157], cyan = [70, 230, 255], red = [255, 90, 110];

  function set(x, y, c, a = 1) {
    const i = (y * size + x) * 4;
    const ea = a;
    buf[i] = buf[i] * (1 - ea) + c[0] * ea;
    buf[i + 1] = buf[i + 1] * (1 - ea) + c[1] * ea;
    buf[i + 2] = buf[i + 2] * (1 - ea) + c[2] * ea;
    buf[i + 3] = 255;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // radial gradient background
      const dx = (x - cx) / size, dy = (y - cy) / size;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.7);
      set(x, y, mix(bgTop, bgBot, d), 1);
    }
  }

  // rounded reel window (dark panel) with gold border
  const winR = R * 0.92;
  const rad = winR * 0.22;
  function rrAlpha(x, y, halfW, halfH, r) {
    const qx = Math.abs(x - cx) - (halfW - r);
    const qy = Math.abs(y - cy) - (halfH - r);
    const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    return -dist; // >0 inside
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = rrAlpha(x, y, winR, winR, rad);
      if (inside > -2) {
        const border = 6 + size * 0.02;
        if (inside < border) set(x, y, gold, Math.min(1, (border - Math.max(0, inside)) / border + .2));
        else set(x, y, [14, 11, 36], 1);
      }
    }
  }

  // three reel symbols (circles): cherry red, gold, cyan
  const cols = [red, gold, cyan];
  const slotW = winR * 0.5;
  const cxs = [cx - slotW, cx, cx + slotW];
  const symR = winR * 0.20;
  for (let s = 0; s < 3; s++) {
    const scx = cxs[s], scy = cy;
    for (let y = Math.floor(scy - symR); y <= scy + symR; y++) {
      for (let x = Math.floor(scx - symR); x <= scx + symR; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dd = Math.hypot(x - scx, y - scy);
        if (dd <= symR) {
          const shade = mix(cols[s], [255, 255, 255], Math.max(0, 1 - dd / symR) * 0.35);
          set(x, y, shade, 1);
        }
      }
    }
  }

  return png(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), draw(192, false));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), draw(512, false));
fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), draw(512, true));
console.log('Icons written to', outDir);
