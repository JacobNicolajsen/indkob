const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Simpel in-memory cache
let icsCache  = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutter

/**
 * Parser iCal-tekst og returnerer array af { summary, dtstart, allDay }
 * Håndterer:
 *  - CRLF og LF linjeskift
 *  - Linjefold med space og tab (RFC 5545)
 *  - DTSTART;VALUE=DATE (heldagsaftaler)
 *  - DTSTART;TZID=... (lokal tidszone — bruges som er, ignorér konvertering)
 *  - DTSTART med Z-suffix (UTC → konverter til lokal dato)
 */
function parseIcs(text) {
  const events = [];

  // Normaliser linjeskift og unfold (space eller tab efter CRLF/LF = fortsættelse)
  const unfolded = text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');

  const lines = unfolded.split('\n');

  let inEvent = false;
  let current = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (line === 'END:VEVENT')   {
      if (inEvent && current.summary && current.dtstart) events.push(current);
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;

    const rawKey = line.slice(0, colon);   // fx "DTSTART;TZID=Europe/Copenhagen"
    const val    = line.slice(colon + 1);  // fx "20260406T100000"

    // Hent egenskabsnavnet (før evt. semikolon-parametre)
    const propName = rawKey.split(';')[0].toUpperCase();

    if (propName === 'SUMMARY') {
      current.summary = val.replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';').trim();
    }

    if (propName === 'DTSTART') {
      const isAllDay  = rawKey.toUpperCase().includes('VALUE=DATE') && !val.includes('T');
      const isUtc     = val.endsWith('Z');
      const hasTzid   = rawKey.toUpperCase().includes('TZID');

      if (isAllDay) {
        // Heldagsaftale: 20260406
        current.dtstart = parseDateOnly(val);
        current.allDay  = true;
      } else if (isUtc) {
        // UTC-tid: konverter til lokal dato/tid
        const d = new Date(
          val.slice(0,4), val.slice(4,6)-1, val.slice(6,8),
          val.slice(9,11), val.slice(11,13), val.slice(13,15)
        );
        // d er nu UTC som lokal — korrekt via Date constructor? Nej — brug UTC explicit
        const utcMs = Date.UTC(
          parseInt(val.slice(0,4)),
          parseInt(val.slice(4,6)) - 1,
          parseInt(val.slice(6,8)),
          parseInt(val.slice(9,11)),
          parseInt(val.slice(11,13)),
          parseInt(val.slice(13,15) || '0')
        );
        const local = new Date(utcMs);
        current.dtstart = localDateTimeStr(local);
        current.allDay  = false;
      } else {
        // Lokal tid (med eller uden TZID) — bruges som er
        current.dtstart = parseLocalDateTime(val);
        current.allDay  = false;
      }
    }
  }

  return events;
}

function parseDateOnly(val) {
  // 20260406 → 2026-04-06
  return `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`;
}

function parseLocalDateTime(val) {
  // 20260406T100000 → 2026-04-06T10:00
  const clean = val.replace('Z','');
  const date  = `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`;
  if (clean.length < 11) return date;
  const time = `${clean.slice(9,11)}:${clean.slice(11,13)}`;
  return `${date}T${time}`;
}

function localDateTimeStr(d) {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h  = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${dd}T${h}:${mi}`;
}

// GET /api/ics?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date er påkrævet' });

  const row = db.prepare("SELECT value FROM settings WHERE key = 'ics_url'").get();
  const rawUrl = row?.value?.trim();

  if (!rawUrl) return res.json({ events: [] });

  // webcal:// er identisk med https:// — Node's fetch kender ikke skemaet
  const url = rawUrl.replace(/^webcal:\/\//i, 'https://');

  // Hent og cache ICS-feed
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
    .filter(e => e.dtstart && e.dtstart.startsWith(date))
    .map(e => ({
      summary: e.summary,
      time:    (!e.allDay && e.dtstart.includes('T')) ? e.dtstart.slice(11, 16) : null,
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
