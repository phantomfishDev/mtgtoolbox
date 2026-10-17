# mtgproxy

A local-first Magic: the Gathering proxy print-sheet generator — a CLI that turns a
decklist into a print-ready PDF at true card size, a web app for browsing and tweaking,
and a plain-file collection tracker so you only proxy the cards you don't already own.

> **Status:** M4 complete — everything works from the CLI, the web app runs the same
> engine in the browser, and `mtgproxy serve` lets that app read and write the CLI's
> own files, decklists included. Next is bulk-data ingestion and the Pages deploy.
> See [docs/PLAN.md](docs/PLAN.md) for the full architecture.

## Install

```bash
pnpm install
pnpm build
pnpm link --global   # puts `mtgproxy` on your PATH
```

Or run it without linking: `node apps/cli/dist/index.js <command>`.

## Usage

Render a decklist to a PDF:

```bash
mtgproxy print examples/rats.txt
```

Check what a list resolves to, without generating anything:

```bash
mtgproxy resolve examples/rats.txt
```

Pipe a list in from anywhere:

```bash
pbpaste | mtgproxy print -
```

### Deck list formats

The parser accepts all of these, and will report every bad line at once rather than
stopping at the first:

```
1 Sol Ring                        plain quantity and name
4x Lightning Bolt                 the x is optional
Sol Ring                          bare name means one copy
1 Cultivate (MSC) 172             pin an exact printing
1 Malakir Rebirth // Malakir Mire double-faced cards
# comment                         ignored
Commander: Sheoldred              section labels are unwrapped
```

Point it at a markdown file — such as a guide written by the `commander-deck-builder`
skill — and it finds the decklist block automatically, preferring the one under the
copy-list heading.

### Print options

| Flag | Default | Notes |
|---|---|---|
| `-o, --output <path>` | alongside the input | output PDF path |
| `-p, --paper <size>` | `a4` | `a4`, `letter`, `legal`, `a3` |
| `-g, --guides <style>` | `crop` | `crop` marks in the margins, `lines` across the sheet, or `none` |
| `-q, --quality <level>` | `png` | `png`, `large`, `normal` |
| `--gap <mm>` | `0` | space between cards; `0` tiles them so one cut serves two |
| `--markdown` | auto | force markdown block extraction |
| `-m, --missing-only` | off | print only cards not already in your collection |

## Web app

```bash
pnpm --filter @mtgproxy/web dev
```

Then open <http://localhost:5173>. The **Decks** tab lists every decklist in
[`examples/`](examples) with its commander's card image, colour identity, Commander
bracket, and how many of its cards you already own. **View cards** opens the deck
card by card — grouped by type, with every printing exactly as it would be printed, and
click any card for a full-size look. **Print** sends it straight to the printer.

Anything you drop into that directory as a `.txt` appears there automatically; the files
are inlined at build time, so the list works in the static deployment too. A card count
other than 100 is badged in amber, which is a quick way to spot an unfinished list.

The commander is read from the list itself: either an explicit `Commander` header, or —
following the convention Moxfield and Archidekt export — any cards sitting above a
`Deck` header.

### Cards the deck runs several copies of

A tile for a card with more than one copy carries two extra controls. **different art each**
splits it into one tile per copy and gives each a visibly different artwork — one printing
per illustration, not the same picture in nine frames. **choose per copy** splits it without
choosing, so you can pick each one yourself; **same printing for all** collapses it back.

Where a card has fewer distinct artworks than copies, some repeat and the app says so,
naming the preference responsible so you know which setting to relax.

On the **Print** tab you can paste a decklist, see every card resolved with
owned/missing badges, click any card to browse and pick a different printing, and
download the PDF — all generated in the browser by the same code the CLI runs.

On a **deck** page the same picker is behind each card's *art* link, and the choice is
kept. A pin is written into the decklist itself as `1 Sol Ring (LTC) 284`, because that
file is what gets committed, diffed and pasted elsewhere — so a pin set in the browser
is a pin the CLI obeys, and one typed by hand shows up in the browser. Under
`mtgproxy serve` the rewrite lands in `examples/<deck>.txt`; without it, the same
overlay is kept in your browser and applied in memory, leaving the repository alone.
The line under the deck title always says which of the two you are getting.

The app works entirely offline of any backend. It stores your collection and
preferences in the browser (IndexedDB). The **Collection** tab imports a ManaBox CSV
export or a `collection.json` — choosing whether to add to or replace what is there, and
listing any rows it could not read — and exports either format back out. When `mtgproxy serve` is running it will instead read and write the same
files the CLI uses; the header always says which of the two is in effect.

Card data, printing lists and images are cached in the browser (IndexedDB), and the
resolved deck itself is cached for the session, so reopening a deck you have already
looked at is instant rather than a repeat of the work.

The cache key covers everything that can change the answer — the decklist, your
preference profile, pinned printings, and (only when `preferOwned` is on) what you own —
so changing a preference produces a fresh resolution instead of a stale hit.

When Scryfall rate-limits a request or the connection drops, the app waits and retries
rather than losing a long resolution, and says so on screen instead of appearing to
hang. If it does fail, **Try again** re-runs it and bypasses the cache.

## Serving the app against your own files

```bash
mtgproxy serve                    # http://127.0.0.1:5174
mtgproxy serve --port 8080 --decks ~/decks
mtgproxy serve --site apps/web/dist   # serve a built app too, one process
```

It binds the loopback interface, because it writes to your collection, your config and
your decklists and nothing about it belongs on a network. In development run the web app
with `pnpm --filter @mtgproxy/web dev` and it proxies `/api` here; the app probes
`/api/health` at boot and falls back to browser storage when nothing answers, which is
exactly what a static deployment gets.

## Stored card data

Every decklist in [`examples/`](examples) has a `<deck>.cards.json` beside it holding the
card data for the printings it resolved to. Without it, opening a deck costs one Scryfall
request per distinct card — about a minute for a hundred of them, every time, on every
machine. With it, that becomes a single local read.

```bash
mtgproxy sync                 # store data for every deck
mtgproxy sync my-new-deck.txt # copy a new deck in and store its data too
mtgproxy sync --force         # re-resolve even when the stored data looks current
mtgproxy sync --refresh       # re-read the chosen printings, to pick up new card fields
```

`sync` also writes `decks.index.json`, a summary the deck list reads: commander images,
colours, brackets and enough of each card to count what you own. Without it the list
would have to load every deck's card data — about a megabyte — before it could render.

`--refresh` exists because this project occasionally starts reading a card field it did
not store before. Re-resolving to fill that in would cost one request per card for no
benefit, since the printings were already chosen; looking those exact printings up by id
costs one request per seventy-five. Adding colour identity across eight decks took four
seconds this way, against roughly ten minutes for a full re-resolve.

Passing a decklist from outside the decks directory copies it in, so a new deck and its
data end up side by side. `--decks <dir>` or `$MTGPROXY_DECKS` moves the directory.

**Only the chosen printings are stored, and never image bytes** — just the URLs Scryfall
serves images from. Storing every printing of every card would be about 1.5 MB per deck
against 60 KB for the chosen ones; the web app fetches a deck's file only when you open
that deck, rather than bundling them all.

The cost of storing only the chosen printings is that the file is valid only for the
rules that chose them. Both the preference profile and — when `preferOwned` is on — the
collection are fingerprinted into the file and checked on load, so changing a preference
or your collection falls back to resolving properly instead of quietly showing printings
that contradict your settings. Run `mtgproxy sync` again to regenerate against your own
setup.

The committed files were generated against an empty collection, which is what a first-time
visitor has.

## Mana curve

The deck view charts the curve of a deck's nonland cards, and `mtgproxy curve <file>`
prints the same thing in a terminal.

Two details it gets right that most curves do not. A card whose *back* face is a land
is charted as the spell it is, not dropped as a land — Scryfall's combined type line
reads `Instant // Land`, which is easy to misread. And a split card is charted at its
front half's cost, not the sum of both halves that Scryfall reports.

The chart also names what makes it misleading — cost reducers, free casts, X spells,
cascade and suspend, and cards with a land on the back. A printed curve is only the
truth for a deck that pays full price for everything.

## Commander bracket

The deck view assesses which bracket a deck's contents sit in, and `mtgproxy bracket
<file>` does the same in a terminal. It names the cards behind the call, because a
bracket is something you say out loud to a table and an unexplained number is not much
use.

Game Changers come from Scryfall's own `game_changer` flag rather than a list checked
into this repo, so they stay current as the list changes. Mass land denial and
extra-turn chains are matched from oracle text, deliberately narrowly — wrongly calling
a deck bracket 4 is worse than missing a signal.

It is explicit about its limits. Two-card infinite combos are not detected, and neither
bracket 1 nor bracket 5 is ever assigned automatically: one is a statement of intent
about how a deck is meant to be played, the other an agreement between players. Those
are listed in the output rather than folded silently into the number.

Tutors are not counted — they stopped being a bracket criterion in the October 2025
update.

## Your collection

Track what you own so you only proxy the gaps.

```bash
mtgproxy collection add "Sol Ring" --quantity 2
mtgproxy collection add "Cultivate" --set msc --number 172
mtgproxy collection list
mtgproxy collection stats
```

Cards are resolved through Scryfall as they are added, so the stored name and printing
are canonical rather than however you typed them. The file lives at
`~/.config/mtgproxy/collection.json` (override with `--collection` or
`$MTGPROXY_COLLECTION`), sorted stably so it stays readable and diffable under version
control. Writes go through a temp file and a rename, keeping the previous version as
`.bak` — a crash mid-write leaves either the old file or the new one, never a mixture.

Then see what a deck would cost you:

```bash
mtgproxy diff my-deck.md
mtgproxy print my-deck.md --missing-only
```

Basic lands count as owned by default, since most people have plenty; pass
`--no-assume-basics` to include them. Any printing of a card counts as owning it unless
you pass `--strict-printing`.

### ManaBox import and export

If you have scanned your cards into [ManaBox](https://www.manabox.app), export the
collection from its Collection tab and read the CSV straight in:

```bash
mtgproxy collection import ~/Downloads/ManaBox_Collection.csv
mtgproxy collection export manabox-collection.csv
```

Import **adds** the copies to what you already hold; pass `--replace` to swap the
collection out instead, and `--dry-run` to see the effect first. Columns are matched by
name in any order, so a file that has been through a spreadsheet — or that came from a
neighbouring tracker using the same shape — still lands. Repeated printings merge, and
each card's ManaBox binder becomes a tag you can search on (`--no-binder-tags` to skip
it).

A row that cannot identify a printing is reported with its line number and left out,
rather than throwing away the rest of the file:

```
  read 1204 rows, 1203 usable
warning skipped 1 rows:
  line 5 Lightning Greaves: no collector number
```

The same command reads this tool's own `collection.json`, chosen by file extension, so
one import path covers both. Export writes ManaBox's own CSV by default and
`--json` for the native file; with no filename it goes to standard output, so it pipes.

Set code, collector number, finish, quantity, language and Scryfall id survive the round
trip in both directions. Condition, grading and purchase price do not: this tool has no
use for them, and the export leaves those columns blank rather than inventing a
`near_mint` it has never seen. Foil, etched and non-English copies of one printing are
tracked as separate entries, because they are separate physical cards.

## Printing preferences

Choose *which version* of each card gets printed.

```bash
mtgproxy print deck.md --prefer-set cmm --full-art
mtgproxy print deck.md --no-ub --borderless
mtgproxy prints "Sol Ring" --explain
```

| Flag | Effect |
|---|---|
| `--prefer-set <code>` | favour this set; repeatable, and earlier entries win |
| `--avoid-set <code>` | penalise this set |
| `--require-set <code>` | restrict to these sets entirely |
| `--full-art` | favour full-art printings |
| `--borderless` | favour borderless printings |
| `--retro` | favour retro-frame printings |
| `--frame-effect <name>` | favour a frame effect, e.g. `showcase`, `extendedart` |
| `--no-ub` | avoid Universes Beyond printings |
| `--no-prefer-owned` | stop favouring printings you already own |
| `--profile <name>` | use a named profile from the config file |

Precedence runs strongest first: a printing named on the decklist line, then a saved
pin, then command-line flags, then the named profile, then built-in defaults.

An explicit `avoid` outranks every positive signal, including preferring cards you
already own — asking for no Universes Beyond printings means it even if you happen to
own one.

Save profiles in `~/.config/mtgproxy/config.json`:

```bash
mtgproxy prefs init
mtgproxy prefs show --profile retro
```

```jsonc
{
  "defaultProfile": "mine",
  "profiles": {
    "mine": {
      "preferSets": ["cmm", "ltc"],
      "borderless": "prefer",
      "universesBeyond": "avoid",
      "basics": { "preferSets": ["unf"], "fullArt": "require" }
    }
  }
}
```

`basics` is a separate sub-policy layered on top of the main one, because wanting every
Swamp from one specific full-art set is a different preference from how you treat
spells — and in a 38-land deck it is most of what you see.

To always use one exact printing of a card:

```bash
mtgproxy pin "Sol Ring" --set soc --number 427
```

Pins are checked against Scryfall when set, so a wrong collector number fails
immediately rather than silently falling back during your next print run.

### The default profile

Out of the box the tool prefers full-art and borderless treatments, avoids Universes
Beyond, favours printings from The Hobbit, and allows low-resolution scans rather than
dropping an artwork for lacking a high-resolution one:

```jsonc
{
  "requireHighres": false,
  "lang": "en",
  "textless": "avoid",
  "avoidSetTypes": ["memorabilia", "funny", "token"],
  "preferOwned": true,
  "fullArt": "prefer",
  "borderless": "prefer",
  "universesBeyond": "avoid",
  "preferSets": ["hob"],
  "basics": { "preferSets": [], "fullArt": "prefer" }
}
```

Override any of it per run with the flags above, or edit
`~/.config/mtgproxy/config.json`.

### What preferences cost

A profile expressing no real preference — only rules that exclude unprintable cards —
resolves a deck in **two** requests via Scryfall's batch endpoint. Any rule that can
change *which* printing wins means every printing of every distinct card has to be
fetched and ranked instead, at **one request per distinct name**.

**The default profile above is an active one**, so decks take the per-card path.
Measured on a 100-card deck with 54 distinct cards:

| | Time |
|---|---|
| First run, cold cache | **~65 seconds** |
| Every run after, cached | **~0.2 seconds** |

Round-trip latency dominates, not the request throttle, so the cold number scales with
distinct card count rather than deck size. Printing lists cache for a week.

If you want the fast path, strip the taste rules (`fullArt`, `borderless`,
`universesBeyond`, `preferSets`, `basics`) and keep only the safety ones. Ingesting
Scryfall's bulk data would remove the cold cost entirely; that is on the
[roadmap](docs/ROADMAP.md).

### A note on quality and file size

`--quality png` is Scryfall's best source: 744x1040 px, about **298 DPI** at card size,
with pre-rounded transparent corners. It is also large — roughly **1.2 MB per distinct
card**, so a 100-card Commander deck produces a **~100 MB** PDF.

`--quality large` is **269 DPI** JPEG and produces about **11 MB** for the same deck.
The difference is invisible on a home printer, and some print shops reject very large
uploads, so reach for it whenever 298 DPI is not specifically needed.

Cards are never scaled to fit. If a grid will not fit the paper at true size, the grid
gets smaller rather than the cards.

## Printing

Cards are laid out at **63 x 88 mm** — true Magic card size — nine to a page.

**Print at 100% scale, with "fit to page" or "shrink to fit" turned off.** Any scaling
by the print dialog makes the cards the wrong size, which is the single most common way
to waste a sheet.

## Caching

Card data and images are cached under `~/.cache/mtgproxy` (or `$XDG_CACHE_HOME`), so
re-printing a deck needs no network at all.

```bash
mtgproxy cache info
mtgproxy cache clear images
```

Printing lists are cached for a week rather than forever, because new printings appear
when sets release and a stale list would silently hide them.

## Known limitations

Double-faced cards print their front face only. The back is not silently dropped —
`resolve` and `print` both warn for each one. Back-face and duplex output are planned.

## Development

```bash
pnpm typecheck
pnpm test
```

## Planned

Designs for work not yet built — Moxfield export, mana curve, deck brackets, and
GitHub Pages hosting — are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Credits

Card data and images come from the [Scryfall API](https://scryfall.com/docs/api).
This project is unaffiliated with Scryfall.

Magic: the Gathering is a trademark of Wizards of the Coast. This project is
unaffiliated with and unendorsed by Wizards of the Coast, and is intended for printing
personal playtest proxies.

## License

[MIT](LICENSE)
