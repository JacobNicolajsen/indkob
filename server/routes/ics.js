const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Simpel in-memory cache
let icsCache  = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutter

/**
 * Parser iCal-tekst og returnerer array af { summary, dtstart, dtend }
 */
function parseIcs(text) {
  const events = [];
  const lines  = text.replace(/\r\n /g, '').replace(/\r\n/g, '\n').split('\n');

  let inEvent  = false;
  let current  = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (line === 'END:VEVENT')   { if (inEvent) events.push(current); inEvent = false; continue; }
    if (!inEvent) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(';')[0].toUpperCase();
    const val = line.slice(colon + 1).trim();

    if (key === 'SUMMARY')  current.summary = val;
    if (key === 'DTSTART')  current.dtstart = parseIcalDate(val);
    if (key === 'DTEND')    current.dtend   = parseIcalDate(val);
    if (key === 'DTSTART;VALUE=DATE') current.dtstart = parseIcalDate(val);
  }

  return events;
}

function parseIcalDate(val) {
  // Format: 20260406 eller 20260406T100000Z eller 20260406T100000
  const s = val.replace('Z', '');
  if (s.length === 8) return s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8);
  const date = s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8);
  const time = s.slice(9,11) + ':' + s.slice(11,13);
  return `${date}T${time}`;
}

// GET /api/ics?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date er påkrævet' });

  const row = db.prepare("SELECT value FROM settings WHERE key = 'ics_url'").get();
  const url = row?.value?.trim();

  if (!url) return res.json({ events: [] });

  // Cache
  const now = Date.now();
  if (!icsCache || now - cacheTime > CACHE_TTL) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'IndkobsAssistent/1.0' },
        signal:  AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      icsCache  = parseIcs(await r.text());
      cacheTime = now;
    } catch (e) {
      console.warn('ICS fetch fejl:', e.message);
      return res.json({ events: [], warning: e.message });
    }
  }

  // Filtrer events på dato
  const events = (icsCache || [])
    .filter(e => e.dtstart && e.dtstart.startsWith(date) && e.summary)
    .map(e => ({
      summary: e.summary,
      time:    e.dtstart.includes('T') ? e.dtstart.slice(11, 16) : null,
    }));

  res.json({ events });
});

// POST /api/ics/refresh — tving cache-refresh
router.post('/refresh', (req, res) => {
  icsCache  = null;
  cacheTime = 0;
  res.json({ ok: true });
});

module.exports = router;
