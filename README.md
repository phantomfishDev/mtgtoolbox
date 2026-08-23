# mtgproxy

A local-first Magic: the Gathering proxy print-sheet generator — a CLI that turns a
decklist into a print-ready PDF at true card size, a web app for browsing and tweaking,
and a plain-file collection tracker so you only proxy the cards you don't already own.

> **Status:** M1 complete — decklist parsing, Scryfall resolution and PDF output all
> work from the CLI. The collection tracker, printing preferences and web app are next.
> See [docs/PLAN.md](docs/PLAN.md) for the full architecture and milestones.

## Install

```bash
pnpm install
pnpm build
```

## Usage

Render a decklist to a PDF:

```bash
node apps/cli/dist/index.js print examples/sample-deck.txt
```

Check what a list resolves to, without generating anything:

```bash
node apps/cli/dist/index.js resolve examples/sample-deck.txt
```

Pipe a list in from anywhere:

```bash
pbpaste | node apps/cli/dist/index.js print -
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

### Options

| Flag | Default | Notes |
|---|---|---|
| `-o, --output <path>` | alongside the input | output PDF path |
| `-p, --paper <size>` | `a4` | `a4`, `letter`, `legal`, `a3` |
| `-g, --guides <style>` | `crop` | `crop` marks in the margins, `lines` across the sheet, or `none` |
| `-q, --quality <level>` | `png` | `png`, `large`, `normal` |
| `--gap <mm>` | `0` | space between cards; `0` tiles them so one cut serves two |
| `--markdown` | auto | force markdown block extraction |

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
node apps/cli/dist/index.js cache info
node apps/cli/dist/index.js cache clear images
```

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
