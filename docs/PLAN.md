# mtgproxy — architecture plan

A local-first Magic: the Gathering proxy print-sheet generator: a CLI for producing
print-ready PDFs, a React web app for browsing and tweaking, and a collection file
that tracks what you already own so you only proxy the gaps.

Inspired by [mtgprint.net](https://mtgprint.net/). Not affiliated with it, or with
Wizards of the Coast.

## Goals

1. Take a decklist — especially the paste block produced by the `commander-deck-builder`
   skill — and emit a PDF that prints at true card size.
2. Work equally well from a terminal and from a browser.
3. Track a card collection in a plain file on disk, and use it to skip printing cards
   already owned.
4. Let the user express *which printing* of a card to use: preferred sets, full art,
   borderless, and so on.
5. Be a clean public repo others can use.

## Verified facts this design rests on

Confirmed against the live Scryfall API rather than assumed:

- `POST /cards/collection` accepts **75 identifiers per request** and returns a
  `not_found` array. A 100-card deck resolves in two requests.
- `image_uris.png` is **744x1040 px** — about **298 DPI** at true card size (63x88 mm),
  with pre-rounded transparent corners. This is the correct print source; no upscaling.
- `full_art` (boolean) and `border_color === "borderless"` are **independent axes**.
  Sol Ring has 31 borderless printings; Swamp has 132 full-art ones.
- `frame_effects` is **`null` rather than `[]`** when absent. Parsing must handle both.
- `image_status` separates `highres_scan` from `lowres` / `placeholder` / `missing`.
  This matters more than any aesthetic preference — a lowres scan prints visibly badly.
- `set_type` classifies printings (`commander`, `masters`, `box`, `memorabilia`,
  `funny`, ...), so junk printings can be excluded by class instead of by blocklist.

## Repository shape

pnpm workspaces, TypeScript throughout.

```
mtg/
├── pnpm-workspace.yaml, tsconfig.base.json, LICENSE (MIT)
├── packages/
│   ├── core/        @mtgproxy/core   — isomorphic. No fs, no DOM.
│   │   ├── decklist/   parser
│   │   ├── scryfall/   batch client, pluggable cache + fetch
│   │   ├── layout/     mm geometry, page grids, cut guides
│   │   ├── pdf/        pdf-lib renderer
│   │   ├── printing/   preference profiles + scoring
│   │   └── collection/ zod schema, diff, CSV importers
│   └── node/        @mtgproxy/node   — fs caches, collection file I/O, atomic writes
└── apps/
    ├── cli/         @mtgproxy/cli    — `mtgproxy` bin (commander.js)
    └── web/         Vite + React + TS + Tailwind
```

The load-bearing decision: **`core` is isomorphic and owns PDF generation**. `pdf-lib`
runs in Node and in the browser, so the CLI and the web app produce byte-identical PDFs
from the same code. Platform differences hide behind two interfaces — `ImageSource`
and `CollectionStore`.

## 1. Deck list parser

Accepted inputs, in priority order:

1. **A `commander-deck-builder` markdown guide.** Find the fenced block under the
   *"Copy list for mtgprint.net"* heading; fall back to the last decklist-shaped fence.
2. Plain `<qty> <name>` lines.
3. Arena / MTGO with printing: `1 Sol Ring (LTC) 264`.
4. Comments (`#`, `//`), section headers (`Commander`, `Deck`, `Sideboard`), blanks.

Output is `{ quantity, name, set?, collectorNumber?, line, raw }[]` plus a structured
error list. A single malformed line never aborts the parse — every problem is reported
at once, with its line number.

`mtgproxy print -` reads stdin, so skill output can be piped straight in.

## 2. Scryfall layer

- Chunk to 75 identifiers, 100 ms between requests, descriptive `User-Agent` and
  `Accept` headers (both required by Scryfall's API guidelines).
- Prefer `{set, collector_number}` when a line supplies one, else `{name}`; retry
  misses through `/cards/named?fuzzy=`, and report whatever still fails.
- Two caches, card JSON and image bytes, keyed by Scryfall ID. Disk under
  `~/.cache/mtgproxy/` for the CLI; IndexedDB in the browser. A repeat print of the
  same deck is fully offline.
- Scryfall attribution and a Wizards non-affiliation notice ship in the README.

## 3. Layout and PDF

| Property | Value |
|---|---|
| Card size | 63 x 88 mm exact (2.5 x 3.5 in) |
| Grid | 3 x 3 = 9 per page; 100 cards = 12 pages |
| A4 | 210 x 297 mm, margins 10.5 / 16.5 mm |
| Letter | 215.9 x 279.4 mm, margins 13.45 / 7.7 mm |
| Guides | Zero-gap tiling with crop marks bleeding into the margin |

Each unique card image is embedded **once** and referenced N times — this matters for
`7 Swamp`. `--quality png` (298 DPI, default) or `--quality large` (269 DPI JPEG,
roughly 5x smaller).

The README leads with the one instruction that ruins prints when missed:
**print at 100% scale, with "fit to page" turned off.**

## 4. Collection

`~/.config/mtgproxy/collection.json`, overridable via `--collection` or
`MTGPROXY_COLLECTION`. Stably sorted so it stays git-diffable if kept in a private repo.
Atomic writes (temp file plus rename) with a `.bak` — this is the one file that is
genuinely painful to recreate.

```jsonc
{ "version": 1, "updatedAt": "...",
  "cards": [{ "name": "Sol Ring", "set": "ltc", "collectorNumber": "264",
              "scryfallId": "...", "finish": "nonfoil", "quantity": 1,
              "addedAt": "...", "tags": [] }] }
```

CSV importers for ManaBox, Moxfield, Deckbox and Archidekt, to seed from existing data.

## 5. Diff — proxy only the gaps

- Match by **name** by default: any printing counts as owned. `--strict-printing`
  requires set and collector number to match. Finish is ignored unless asked for.
- Multiplicity respected: need 2, own 1, print 1.
- `--assume-basics` (default on) drops basic lands from the missing list.
- `mtgproxy diff deck.md` reports owned/missing without generating anything.

## 6. Printing preferences

A **preference profile** is an ordered rule set. Every candidate printing is scored;
highest wins, with deterministic tie-breaks (newest release, then lowest collector
number) so the same deck always produces the same PDF.

Precedence, strongest first:

| Level | Source | Example |
|---|---|---|
| 1. Pin | `(LTC) 264` in the list, or a saved pin | absolute |
| 2. Deck | CLI flags / web options panel | `--full-art --prefer-set cmm` |
| 3. Profile | `config.json`, named profiles | `--profile retro` |
| 4. Defaults | built in | require highres, English, no digital |

Each rule is `prefer` (weighted), `require` (hard filter) or `avoid`:

```jsonc
{ "profiles": {
    "default": {
      "preferSets": ["cmm", "ltc"],        // ordered; earlier is stronger
      "avoidSets": [],
      "fullArt": "prefer",                  // full_art
      "borderless": "prefer",               // border_color === "borderless"
      "frameEffects": ["showcase", "extendedart"],
      "retroFrame": "avoid",                // frame === "1997"
      "textless": "avoid",                  // unreadable as a proxy
      "universesBeyond": "avoid",
      "avoidSetTypes": ["memorabilia", "funny", "token"],
      "requireHighres": true,               // image_status
      "lang": "en",
      "preferOwned": true,                  // match printings already in the collection
      "basics": { "preferSets": ["unf"], "fullArt": "require" }
    } } }
```

Two rules earn special mention. **`basics`** is a separate sub-policy, because wanting
every Swamp from one specific full-art set is a distinct preference from how spells are
treated — and in a 38-land deck it is most of what you see. **`preferOwned`** falls out
of the collection work for free: printed proxies match the printings actually owned.

### Cost

| Path | Requests for a 100-card deck | When |
|---|---|---|
| Batch (`/cards/collection`, 75 per request) | **2** | no preferences active |
| Per-name (`/cards/search?unique=prints`) | **~85**, about 9 s at 100 ms | any preference active |

Hard filters are pushed into the `q=` string server-side to shrink payloads, and results
cache permanently. At M5, optional **Scryfall bulk data** ingestion (`default_cards`,
downloaded once) makes preference resolution instant and request-free.

### Surface

```bash
mtgproxy print deck.md --profile retro --prefer-set cmm --full-art
mtgproxy prints "Sol Ring" --explain     # ranked list, with score breakdown
mtgproxy pin "Sol Ring" --set ltc --cn 264
mtgproxy prefs show | set | edit
```

`--explain` is built early: when a policy returns an unexpected printing, a score
breakdown is the difference between a two-minute fix and a guess.

## 7. Web app — one build, two modes

At boot the app probes `GET /api/health`.

- **Present** (`mtgproxy serve`): a `HttpCollectionStore` reads and writes the same
  `collection.json` the CLI uses.
- **Absent** (GitHub Pages): an `IndexedDbCollectionStore`, plus import/export buttons.

The UI is identical either way, because both satisfy `CollectionStore`. Three views:
**Print** (paste, resolve, owned/missing badges, options, in-browser PDF download),
**Collection** (searchable table, autocomplete add, import/export), and **Deck** (drop a
skill `.md`, see the diff). The server is a small localhost-bound Hono app serving the
static build plus `/api/collection`.

## 8. Milestones

| # | Deliverable |
|---|---|
| M1 | Scaffold, parser, Scryfall client, layout, PDF, `mtgproxy print` — end-to-end printable deck |
| M2 | Collection file and commands, diff, `--missing-only`, preference engine, profiles, `prints` / `pin` / `prefs` |
| M3 | Web app, static mode, in-browser PDF, per-card printing picker, preferences panel |
| M4 | `mtgproxy serve` and disk-backed collection sync |
| M5 | CSV importers, bulk-data ingestion, CI, Pages deploy, docs |

M1 alone makes the deck-builder skill's output printable.

## Known limitations in v1

**Double-faced cards.** v1 prints the front face only and emits an explicit warning per
DFC card during `resolve`, so nothing is dropped silently. Back-face generation and
duplex-aligned back pages are deferred; the layout engine is built to accept them later
without rework.

## Skill integration

The `commander-deck-builder` skill needs no changes — its Section 8 paste block is
already exactly the format the parser wants. Optionally, one line can be added to the
skill telling it to mention `mtgproxy print <file> --missing-only` after saving a guide.
