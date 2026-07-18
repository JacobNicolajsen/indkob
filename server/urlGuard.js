const dns = require('node:dns/promises');
const net = require('node:net');

/**
 * SSRF-værn: tjekker at en URL peger på en offentlig http(s)-adresse,
 * ikke på localhost eller interne netværk. Kaster Error med dansk besked.
 */

function isPrivateIp(ip) {
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) → tjek IPv4-delen
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
      (a === 169 && b === 254) ||             // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  const low = ip.toLowerCase();
  return low === '::' || low === '::1' ||
    low.startsWith('fc') || low.startsWith('fd') ||  // unique local
    low.startsWith('fe8') || low.startsWith('fe9') ||
    low.startsWith('fea') || low.startsWith('feb');  // link-local
}

async function assertPublicHttpUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Ugyldig URL'); }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Kun http- og https-links er tilladt');
  }

  const host = url.hostname.replace(/^\[|\]$/g, ''); // IPv6-literal uden klammer
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Adressen peger på et internt netværk');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Adressen peger på et internt netværk');
    return url;
  }

  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Kunne ikke slå adressen op');
  }
  if (addrs.length === 0 || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('Adressen peger på et internt netværk');
  }
  return url;
}

module.exports = { assertPublicHttpUrl, isPrivateIp };
