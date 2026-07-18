# indkob
Madplan og indkøbsassistent

## Kørsel

Kræver **Node.js 22.5+** (bruger det indbyggede `node:sqlite`).

```
npm install
npm start
```

## Miljøvariabler (`.env`)

| Variabel            | Beskrivelse                                                        |
|---------------------|--------------------------------------------------------------------|
| `PORT`              | Port (standard 3000)                                               |
| `DB_DIR`            | Mappe til SQLite-databasen (standard `./data`)                     |
| `ANTHROPIC_API_KEY` | Nøgle til AI-opskriftsimport                                       |
| `APP_PASSWORD`      | Sættes den, kræver API'et adgangskode (appen spørger første gang) |

`APP_PASSWORD` bør altid sættes på en offentligt tilgængelig server — uden den
er API'et åbent, inkl. AI-importen (som koster API-forbrug) og kalender-URL'en.
