const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}

function createCanvas(size) {
  return new Uint8Array(size * size * 4);
}

function blendPixel(canvas, size, x, y, r, g, b, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) {
    return;
  }

  const index = (y * size + x) * 4;
  const srcA = clamp(alpha, 0, 255) / 255;
  const dstA = canvas[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) {
    return;
  }

  const outR = (r * srcA + canvas[index] * dstA * (1 - srcA)) / outA;
  const outG = (g * srcA + canvas[index + 1] * dstA * (1 - srcA)) / outA;
  const outB = (b * srcA + canvas[index + 2] * dstA * (1 - srcA)) / outA;

  canvas[index] = Math.round(clamp(outR, 0, 255));
  canvas[index + 1] = Math.round(clamp(outG, 0, 255));
  canvas[index + 2] = Math.round(clamp(outB, 0, 255));
  canvas[index + 3] = Math.round(clamp(outA * 255, 0, 255));
}

function fillCircle(canvas, size, cx, cy, radius, color, alpha = 255) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  const r2 = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) {
        blendPixel(canvas, size, x, y, color[0], color[1], color[2], alpha);
      }
    }
  }
}

function fillRoundedRect(canvas, size, x, y, width, height, radius, color, alpha = 255) {
  const left = x;
  const right = x + width;
  const top = y;
  const bottom = y + height;

  const minX = Math.floor(left);
  const maxX = Math.ceil(right);
  const minY = Math.floor(top);
  const maxY = Math.ceil(bottom);

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const fx = px + 0.5;
      const fy = py + 0.5;

      const dx = Math.max(left + radius - fx, 0, fx - (right - radius));
      const dy = Math.max(top + radius - fy, 0, fy - (bottom - radius));
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(canvas, size, px, py, color[0], color[1], color[2], alpha);
      }
    }
  }
}

function fillArcRing(canvas, size, cx, cy, outerR, innerR, startRad, endRad, color, alpha = 255) {
  const minX = Math.floor(cx - outerR);
  const maxX = Math.ceil(cx + outerR);
  const minY = Math.floor(cy - outerR);
  const maxY = Math.ceil(cy + outerR);
  const outer2 = outerR * outerR;
  const inner2 = innerR * innerR;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > outer2 || dist2 < inner2) {
        continue;
      }

      let angle = Math.atan2(dy, dx);
      if (angle < 0) {
        angle += Math.PI * 2;
      }

      if (startRad <= endRad) {
        if (angle < startRad || angle > endRad) {
          continue;
        }
      } else if (angle > endRad && angle < startRad) {
        continue;
      }

      blendPixel(canvas, size, x, y, color[0], color[1], color[2], alpha);
    }
  }
}

function drawBackground(canvas, size) {
  const center = size / 2;
  const maxRadius = size * 0.72;
  const core = [53, 122, 86];
  const edge = [28, 46, 35];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const radial = clamp(Math.sqrt(dx * dx + dy * dy) / maxRadius, 0, 1);
      const mixed = mixColor(core, edge, radial);

      const hx = (x - size * 0.76) / (size * 0.72);
      const hy = (y - size * 0.2) / (size * 0.64);
      const glow = Math.exp(-(hx * hx + hy * hy) * 3.2);
      const warm = [222, 168, 91];
      const glowStrength = clamp(glow * 0.5, 0, 0.5);
      const lit = mixColor(mixed, warm, glowStrength);

      const index = (y * size + x) * 4;
      canvas[index] = lit[0];
      canvas[index + 1] = lit[1];
      canvas[index + 2] = lit[2];
      canvas[index + 3] = 255;
    }
  }
}

function drawMonogram(canvas, size) {
  const c = size / 2;

  fillCircle(canvas, size, c, c, size * 0.44, [242, 196, 118], 62);
  fillCircle(canvas, size, c, c, size * 0.42, [32, 60, 43], 255);
  fillCircle(canvas, size, c, c, size * 0.36, [248, 236, 211], 248);

  fillRoundedRect(
    canvas,
    size,
    size * 0.21,
    size * 0.28,
    size * 0.18,
    size * 0.44,
    size * 0.032,
    [46, 92, 64],
    255
  );
  fillRoundedRect(
    canvas,
    size,
    size * 0.21,
    size * 0.28,
    size * 0.26,
    size * 0.1,
    size * 0.028,
    [46, 92, 64],
    255
  );
  fillRoundedRect(
    canvas,
    size,
    size * 0.21,
    size * 0.45,
    size * 0.22,
    size * 0.095,
    size * 0.028,
    [46, 92, 64],
    255
  );
  fillRoundedRect(
    canvas,
    size,
    size * 0.21,
    size * 0.62,
    size * 0.27,
    size * 0.1,
    size * 0.028,
    [46, 92, 64],
    255
  );

  fillArcRing(
    canvas,
    size,
    size * 0.64,
    size * 0.5,
    size * 0.22,
    size * 0.14,
    Math.PI * 0.18,
    Math.PI * 1.82,
    [191, 126, 42],
    255
  );
  fillRoundedRect(
    canvas,
    size,
    size * 0.63,
    size * 0.43,
    size * 0.11,
    size * 0.14,
    size * 0.02,
    [248, 236, 211],
    255
  );

  fillRoundedRect(
    canvas,
    size,
    size * 0.3,
    size * 0.72,
    size * 0.38,
    size * 0.085,
    size * 0.025,
    [218, 158, 79],
    255
  );
  fillArcRing(
    canvas,
    size,
    size * 0.5,
    size * 0.72,
    size * 0.26,
    size * 0.21,
    Math.PI * 1.2,
    Math.PI * 1.8,
    [218, 158, 79],
    255
  );
  fillCircle(canvas, size, size * 0.36, size * 0.82, size * 0.043, [45, 73, 55], 255);
  fillCircle(canvas, size, size * 0.64, size * 0.82, size * 0.043, [45, 73, 55], 255);

  fillArcRing(
    canvas,
    size,
    size * 0.74,
    size * 0.28,
    size * 0.1,
    size * 0.04,
    Math.PI * 1.06,
    Math.PI * 1.66,
    [62, 128, 77],
    255
  );
}

function applyCircularMask(canvas, size, padding = 0) {
  const center = (size - 1) / 2;
  const radius = size / 2 - padding;
  const softEdge = Math.max(1.25, size * 0.004);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const alphaIndex = (y * size + x) * 4 + 3;
      const currentAlpha = canvas[alphaIndex];

      if (distance <= radius - softEdge) {
        continue;
      }

      if (distance >= radius + softEdge) {
        canvas[alphaIndex] = 0;
        continue;
      }

      const t = (radius + softEdge - distance) / (softEdge * 2);
      const edgeAlpha = Math.round(clamp(t, 0, 1) * 255);
      canvas[alphaIndex] = Math.min(currentAlpha, edgeAlpha);
    }
  }
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      if ((c & 1) !== 0) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(size, canvas) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = size * 4 + 1;
  const raw = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    const srcStart = y * size * 4;
    Buffer.from(canvas.buffer, canvas.byteOffset + srcStart, size * 4).copy(raw, rowStart + 1);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function writeLogoPng(size, outputPath) {
  const canvas = createCanvas(size);
  drawBackground(canvas, size);
  drawMonogram(canvas, size);
  applyCircularMask(canvas, size, Math.max(1, size * 0.02));
  fs.writeFileSync(outputPath, encodePng(size, canvas));
}

function writeIcoFromPng(pngPath, icoPath) {
  const pngData = fs.readFileSync(pngPath);
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngData.length, 14);
  header.writeUInt32LE(22, 18);

  fs.writeFileSync(icoPath, Buffer.concat([header, pngData]));
}

function buildIcns(outputDir, icnsPath) {
  const iconsetDir = path.join(outputDir, 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });

  const map = [
    ['erpmaniac-logo-16.png', 'icon_16x16.png'],
    ['erpmaniac-logo-32.png', 'icon_16x16@2x.png'],
    ['erpmaniac-logo-32.png', 'icon_32x32.png'],
    ['erpmaniac-logo-64.png', 'icon_32x32@2x.png'],
    ['erpmaniac-logo-128.png', 'icon_128x128.png'],
    ['erpmaniac-logo-256.png', 'icon_128x128@2x.png'],
    ['erpmaniac-logo-256.png', 'icon_256x256.png'],
    ['erpmaniac-logo-512.png', 'icon_256x256@2x.png'],
    ['erpmaniac-logo-512.png', 'icon_512x512.png'],
    ['erpmaniac-logo-1024.png', 'icon_512x512@2x.png']
  ];

  for (const [src, dest] of map) {
    fs.copyFileSync(path.join(outputDir, src), path.join(iconsetDir, dest));
  }

  const result = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], {
    stdio: 'ignore'
  });

  if (result.status !== 0) {
    throw new Error('iconutil failed to generate .icns file');
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  const outputDir = path.join(__dirname, '..', 'assets', 'logo');
  ensureDir(outputDir);

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    writeLogoPng(size, path.join(outputDir, `erpmaniac-logo-${size}.png`));
  }

  fs.copyFileSync(
    path.join(outputDir, 'erpmaniac-logo-512.png'),
    path.join(outputDir, 'icon.png')
  );
  writeIcoFromPng(path.join(outputDir, 'erpmaniac-logo-256.png'), path.join(outputDir, 'icon.ico'));

  try {
    buildIcns(outputDir, path.join(outputDir, 'icon.icns'));
  } catch (error) {
    console.warn(`Warning: ${error.message}`);
  }

  console.log(`Logo assets generated in ${outputDir}`);
}

main();
