// Génère les icônes de la PWA (PNG + SVG) à partir d'un seul dessin.
// Usage : npm i --no-save sharp && node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// Repère de position avec son halo, centré dans un carré de 512
const pin = (scale) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
  <ellipse cx="256" cy="404" rx="108" ry="26" fill="#fff" opacity=".26"/>
  <ellipse cx="256" cy="404" rx="58" ry="14" fill="#fff" opacity=".5"/>
  <path d="M256 84c-72 0-130 56-130 126 0 92 130 186 130 186s130-94 130-186c0-70-58-126-130-126z" fill="#fff"/>
  <circle cx="256" cy="210" r="54" fill="#1d4fd8"/>
</g>`;
const bg = (rx) => `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b7bff"/><stop offset="1" stop-color="#1640b8"/></linearGradient></defs><rect width="512" height="512" rx="${rx}" fill="url(#g)"/>`;
const svg = (rx, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg(rx)}${pin(scale)}</svg>`;

// « maskable » : fond plein cadre et dessin réduit pour rester dans la zone de sécurité (80 %)
const jobs = [
  ['icon-192.png', 192, svg(116, 1)],
  ['icon-512.png', 512, svg(116, 1)],
  ['icon-maskable-512.png', 512, svg(0, 0.74)],
  ['apple-touch-icon.png', 180, svg(0, 0.88)],
  ['favicon-32.png', 32, svg(96, 1)]
];

(async () => {
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg(116, 1));
  for (const [name, size, source] of jobs) {
    await sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
    console.log('icône', name, size + 'px');
  }
})().catch((e) => { console.error(e); process.exit(1); });
