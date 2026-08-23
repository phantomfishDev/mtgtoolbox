# mtgproxy

A local-first Magic: the Gathering proxy print-sheet generator — a CLI that turns a
decklist into a print-ready PDF at true card size, a web app for browsing and tweaking,
and a plain-file collection tracker so you only proxy the cards you don't already own.

> **Status:** M2 complete — decklist parsing, PDF output, collection tracking and
> printing preferences all work from the CLI. The web app is next. See
> [docs/PLAN.md](docs/PLAN.md) for the full architecture and milestones.

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
mtgproxy print examples/sample-deck.txt
```

Check what a list resolves to, without generating anything:

```bash
mtgproxy resolve examples/sample-deck.txt
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

### Why preferences cost more

With no preferences active, a deck resolves in **two** requests via Scryfall's batch
endpoint. Any active preference means every printing of every distinct card has to be
fetched and ranked, which is **one request per distinct name** — about 9 seconds for a
100-card deck, then cached for a week.

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

## Credits

Card data and images come from the [Scryfall API](https://scryfall.com/docs/api).
This project is unaffiliated with Scryfall.

Magic: the Gathering is a trademark of Wizards of the Coast. This project is
unaffiliated with and unendorsed by Wizards of the Coast, and is intended for printing
personal playtest proxies.

## License

[MIT](LICENSE)
