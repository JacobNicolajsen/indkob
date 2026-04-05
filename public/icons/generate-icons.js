// Run once: node generate-icons.js
// Creates simple SVG-based PNG icons for the PWA manifest
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1E1410';
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Shopping cart emoji approximation — just a shopping bag
  const pad = size * 0.2;
  ctx.fillStyle = '#F7F3EE';
  ctx.font = `${size * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🛒', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

writeFileSync('icon-192.png', drawIcon(192));
writeFileSync('icon-512.png', drawIcon(512));
console.log('Icons generated');
