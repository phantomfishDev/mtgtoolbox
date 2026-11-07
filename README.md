# mtgtoolbox

A local-first Magic: the Gathering proxy print-sheet generator — a CLI that turns a
decklist into a print-ready PDF at true card size, and a web app for browsing and tweaking.

> **Status:** M4 complete — everything works from the CLI, the web app runs the same
> engine in the browser, and `mtgtoolbox serve` lets that app read and write the CLI's
> own files, decklists included. Next is bulk-data ingestion and the Pages deploy.
> See [docs/PLAN.md](docs/PLAN.md) for the full architecture.

## Install

```bash
pnpm install
pnpm build
pnpm link --global   # puts `mtgtoolbox` on your PATH
```

Or run it without linking: `node apps/cli/dist/index.js <command>`.

## Usage

Render a decklist to a PDF:

```bash
mtgtoolbox print examples/rats.txt
```

Check what a list resolves to, without generating anything:

```bash
mtgtoolbox resolve examples/rats.txt
```

Pipe a list in from anywhere:

```bash
pbpaste | mtgtoolbox print -
```

Build a new deck with an agent, a card at a time, in the browser:

```bash
mtgtoolbox workshop start thranduil-elf
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
# Name: The Hare Apparent         the deck's display name (see below)
# Owner: Sam                      whose deck it is (see below)
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
| `--tokens <mode>` | `exclude` | `exclude`, `include` or `only` — see [Tokens](#tokens) |

## Web app

```bash
pnpm --filter @mtgtoolbox/web dev
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

### Whose deck it is

Decks accumulate owners — one belongs to a friend who leaves it at your place, another
is yours. Put an `Owner:` line in the comment block at the top of the file and the deck
list says so:

```
# Owner: Sam
# Kibo, Uktabi Prince — Gruul Ape typal.
```

Each named owner becomes a filter chip above the grid, so **Whose deck: Sam** narrows
the page to Sam's decks, and the owner is searchable along with deck and card names.
Leave the line out and the deck simply has no owner, which is the right answer for the
ones that are just yours.

It is deliberately a `#` comment rather than a line of its own. These files get pasted
into mtgprint.net, Archidekt and Moxfield, and a bare `Owner: Sam` line is read by every
one of those — and by this project's own parser — as a card named "Sam". As a comment it
is invisible to all of them.

Only the comment block at the very top of the file counts. Comments further down belong
to the cards beside them, which is where these lists keep their per-card theming notes,
and prose that merely mentions an owner mid-sentence stays prose: the Kibo deck's note
credits the Archidekt list's author as `(owner: swebb)` and is not thereby Swebb's deck.

### What the deck is called

A deck is named after its file — `kwain-hare-apparent.txt` reads as "Kwain Hare
Apparent" — unless the comment block says otherwise with a `Name:` line, written the
same way as `Owner:`:

```
# Name: The Hare Apparent
# Owner: Sam
```

With `mtgtoolbox serve` running, the deck page has a **Rename** link beside the title that
writes this line for you; clearing the name removes it, and the deck goes back to its
filename. The file itself is never renamed, so pins, stored data and the index keep
pointing at the same deck.

### Cards the deck runs several copies of

A tile for a card with more than one copy carries two extra controls. **different art each**
splits it into one tile per copy and gives each a visibly different artwork — one printing
per illustration, not the same picture in nine frames. **choose per copy** splits it without
choosing, so you can pick each one yourself; **same printing for all** collapses it back.

Where a card has fewer distinct artworks than copies, some repeat and the app says so,
naming the preference responsible so you know which setting to relax.

On the **Print** tab you can paste a decklist, see every card resolved, click any card to browse and pick a different printing, and
download the PDF — all generated in the browser by the same code the CLI runs.

On a **deck** page the same picker is behind each card's *art* link, and the choice is
kept. A pin is written into the decklist itself as `1 Sol Ring (LTC) 284`, because that
file is what gets committed, diffed and pasted elsewhere — so a pin set in the browser
is a pin the CLI obeys, and one typed by hand shows up in the browser. Under
`mtgtoolbox serve` the rewrite lands in `examples/<deck>.txt`; without it, the same
overlay is kept in your browser and applied in memory, leaving the repository alone.
The line under the deck title always says which of the two you are getting.

The app works entirely offline of any backend. It stores your preferences in the
browser (IndexedDB). When `mtgtoolbox serve` is running it will instead read and write
the same files the CLI uses; the header always says which of the two is in effect.

Card data, printing lists and images are cached in the browser (IndexedDB), and the
resolved deck itself is cached for the session, so reopening a deck you have already
looked at is instant rather than a repeat of the work.

The list of *other* printings of a card is fetched only when you open the picker for
that one card. Opening a deck never fetches them: it reads the chosen printings from the
stored card data beside the decklist.

The cache key covers everything that can change the answer — the decklist, your
preference profile, pinned printings, and (only when `preferOwned` is on) what you own —
so changing a preference produces a fresh resolution instead of a stale hit.

When Scryfall rate-limits a request or the connection drops, the app waits and retries
rather than losing a long resolution, and says so on screen instead of appearing to
hang. If it does fail, **Try again** re-runs it and bypasses the cache.

## Serving the app against your own files

```bash
mtgtoolbox serve                    # http://127.0.0.1:5174
mtgtoolbox serve --port 8080 --decks ~/decks
mtgtoolbox serve --site apps/web/dist   # serve a built app too, one process
```

It binds the loopback interface, because it writes to your config and your decklists and nothing about it belongs on a network. In development run the web app
with `pnpm --filter @mtgtoolbox/web dev` and it proxies `/api` here; the app probes
`/api/health` at boot and falls back to browser storage when nothing answers, which is
exactly what a static deployment gets.

## Sharing the deck list

The web app is a static site — card data comes from Scryfall, preferences live in the
browser — so it can be published to GitHub Pages and handed to a friend as a link.
What they get is the **Decks** tab: every deck on the shelf with its commander's art,
colours, bracket and owner, and every card in it a click away. It is read-only, and
nothing they do there touches anything of yours.

### Showcase mode

What gets published is not the whole app. The deploy builds in *showcase mode*, which
is the same code with everything that writes taken out:

```bash
pnpm --filter @mtgtoolbox/web build:showcase
```

| | Local build | Showcase build |
|---|---|---|
| Tabs | Decks, Print, Preferences | Decks, Print |
| Change a card's printing | yes | no |
| Writes anything, anywhere | config, pins | nothing |
| Asks for `/api` | probes for `mtgtoolbox serve` | never |

The guarantee is structural rather than cosmetic. Showcase mode runs on a
`ReadOnlyStore` whose every write method throws, and it skips the `/api/health` probe
entirely, so the published page talks to nothing but Scryfall's image CDN. The one tab
that writes — Preferences — is dropped, and the printing
picker is not rendered at all, so there is no path to a write left to take.

`VITE_SHOWCASE_TITLE` names the page — it defaults to "The Deck Shelf", since the
project's own name describes how it is built rather than what is being shared.

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds and publishes on
every push to `main`. Pages is already switched on for this repository, with its source
set to GitHub Actions, so there is nothing to set up: the site is live at
<https://phantomfishdev.github.io/mtgtoolbox/> and the workflow can also be run by hand
from the Actions tab.

### What it costs

Nothing. This repository is public, and Pages and Actions are both free there —
standard runners on public repositories do not draw from the account's compute
allowance at all.

It is worth knowing why public is the choice that costs nothing. On the Free plan Pages
publishes only from public repositories; publishing from a private one needs Pro, Team
or Enterprise, from $4/month. But a paid plan would keep the *source* private, not the
site — restricting who can view a Pages site is an Enterprise Cloud feature, so the
published page is public either way. Paying would have bought privacy for the code
alone, and there is nothing in here that needs it: no secrets, MIT licensed already,
and preferences live in the browser or `~/.config`, never in the repo.

## Building a deck with an agent

A deck is easier to build with two people than one: whoever owns the deck knows which
cards they want and what it should feel like, and the other half is ninety cards of
legwork. `mtgtoolbox workshop` is that conversation, held over one session file.

```bash
mtgtoolbox workshop start thranduil-elf --title "Thranduil, Elvenking"
```

It serves a page — card search with real art and text, a commander picker, a bracket
ceiling, the cards you already know you want and the ones to keep out — and prints its
URL. The port is whatever the OS had free, so several of these run side by side without
colliding.

Everything after that is turns, tracked by the session's phase:

| phase      | whose turn | what happens                                   |
| ---------- | ---------- | ---------------------------------------------- |
| `intake`   | you        | fill in the brief in the page                  |
| `briefed`  | the agent  | it reads the brief and builds a list           |
| `proposed` | you        | the page becomes a review screen               |
| `reviewed` | the agent  | it reads your cuts and comments, and revises   |
| `accepted` | done       | the list can be exported                       |

The agent's side is four commands:

```bash
mtgtoolbox workshop wait thranduil-elf      # blocks until it is its turn
mtgtoolbox workshop show thranduil-elf      # the brief, the cuts, the comments
mtgtoolbox workshop propose thranduil-elf   # put a decklist on the table
mtgtoolbox workshop export thranduil-elf    # write examples/thranduil-elf.txt
```

`propose` reads `.workshop/<deck>/proposal.json` — a list of cards with a role and a
line on why each one is there — looks every card up in one batch, and reports the mana
curve, the land count, the bracket it assesses at and any name that does not exist. The
page an open browser is showing switches to the review screen on its own.

`propose --replace` corrects the round already on the table rather than starting a new
one — for a wrong card note or a miscount. It leaves the round number, the phase and any
half-written review alone, which a second `propose` would not.

The review screen shows the deck as cards, grouped by role. Click any card to read it
full size and arrow-key through the rest of the list. Cutting one strikes it through;
every card takes a comment, kept or cut, and those comments are the most useful thing the
agent gets back. Accepting writes the list out with `export`, and from there it
is an ordinary decklist: `sync` it, then pick the printings.

Proposed cards are deliberately left unpinned, so the printing is chosen by your
preference profile at sync time rather than by whatever Scryfall happened to return. The
art in the review screen is only there to recognise the card by.

## Stored card data

Every decklist in [`examples/`](examples) has a `<deck>.cards.json` beside it holding the
card data for the printings it resolved to. Without it, opening a deck costs one Scryfall
request per distinct card — about a minute for a hundred of them, every time, on every
machine. With it, that becomes a single local read.

```bash
mtgtoolbox sync                 # store data for every deck
mtgtoolbox sync my-new-deck.txt # copy a new deck in and store its data too
mtgtoolbox sync --force         # re-resolve even when the stored data looks current
mtgtoolbox sync --refresh       # re-read the chosen printings, to pick up new card fields
```

`sync` also writes `decks.index.json`, a summary the deck list reads: commander images,
colours, brackets and enough of each card to count what you own. Without it the list
would have to load every deck's card data — about a megabyte — before it could render.

Stored data stays in play when you pin a printing. A pin rewrites the list as
`1 Fog (M14) 171`, which the file — written before the pin existed — has no card for.
Rather than give up and send the whole deck back through ranking to re-decide
ninety-nine printings that did not change, the pinned line is looked up by set and
number directly: one batched request, however many pins are new. Changing an artwork in
the deck browser therefore costs a single request instead of one per distinct card.

Under `mtgtoolbox serve`, saving a pin also rewrites that deck's `.cards.json` and its
entry in `decks.index.json` the same way, so the deck list's commander art follows the
pin straight away rather than waiting for the next `sync`. The app reads the index from
the server rather than the copy baked into the build, since that copy cannot see the
change.

`--refresh` exists because this project occasionally starts reading a card field it did
not store before. Re-resolving to fill that in would cost one request per card for no
benefit, since the printings were already chosen; looking those exact printings up by id
costs one request per seventy-five. Adding colour identity across eight decks took four
seconds this way, against roughly ten minutes for a full re-resolve.

Passing a decklist from outside the decks directory copies it in, so a new deck and its
data end up side by side. `--decks <dir>` or `$MTGTOOLBOX_DECKS` moves the directory.

**Only the chosen printings are stored, and never image bytes** — just the URLs Scryfall
serves images from. Storing every printing of every card would be about 1.5 MB per deck
against 60 KB for the chosen ones; the web app fetches a deck's file only when you open
that deck, rather than bundling them all.

The cost of storing only the chosen printings is that the file is valid only for the
rules that chose them. The preference profile is fingerprinted into the file and checked
on load, so changing a preference falls back to resolving properly instead of quietly
showing printings that contradict your settings. Run `mtgtoolbox sync` again to regenerate
against your own setup.

## Mana curve

The deck view charts the curve of a deck's nonland cards, and `mtgtoolbox curve <file>`
prints the same thing in a terminal.

Two details it gets right that most curves do not. A card whose *back* face is a land
is charted as the spell it is, not dropped as a land — Scryfall's combined type line
reads `Instant // Land`, which is easy to misread. And a split card is charted at its
front half's cost, not the sum of both halves that Scryfall reports.

The chart also names what makes it misleading — cost reducers, free casts, X spells,
cascade and suspend, and cards with a land on the back. A printed curve is only the
truth for a deck that pays full price for everything.

## Commander bracket

The deck view assesses which bracket a deck's contents sit in, and `mtgtoolbox bracket
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

## Tokens

A deck can list the tokens it makes, under a `Tokens` header:

```
Tokens
12 Wraith (TLTC) 7
4 Drake (TCMM) 12
3 Clue (PLST) TMKM-15
```

The leading number is how many you want, and `(SET) NUM` pins the art — worth
doing, because token names collide: several different Wraiths exist and only one
is the 3/3 with menace.

**Tokens are not deck cards.** They do not count towards the 100, they are left
out of the mana curve, and the bracket check ignores them. A `Tokens` section
cannot make a legal deck read as 112 cards.

Let the tool work out which tokens a deck can make:

```bash
mtgtoolbox tokens                              # every deck: what each makes, and what is new
mtgtoolbox tokens --write                      # add the new ones to every decklist
mtgtoolbox tokens examples/nazgul.txt --write  # just one deck
mtgtoolbox tokens --write -q 2                 # add new tokens at 2 each instead of 4
```

Nothing is hardcoded: Scryfall's `all_parts` names the tokens each card makes,
so a deck that gains a Clue-maker gains a Clue the next time you run it. Tokens
are deduped by name, type, stats, colour and rules text, so two cards making
the same 2/2 Drake produce one line, and a 3/3 Wraith is never mistaken for a
2/2 one. Run `mtgtoolbox sync` afterwards so the stored card data includes them.

**Writing only ever adds.** Rows already in a `Tokens` section keep their
quantity and their pinned art, so set the counts however you like and re-run
it freely. Set a token to `0` to keep it listed but print none — the row stays
so the next search does not offer it again.

The web app's deck page has the same thing in a **Tokens** panel: *Find tokens*
runs the search, each token has a count to set, clicking a token changes its
art, *Save changes* writes them, and
*Print tokens* opens the print view with only the tokens selected. Under
`mtgtoolbox serve` the counts are written into the decklist itself; without a
server they are kept in the browser, as pins are.

Then choose what a print run does with them:

```bash
mtgtoolbox print my-deck.txt                     # deck only (the default)
mtgtoolbox print my-deck.txt --tokens include    # deck and tokens together
mtgtoolbox print my-deck.txt --tokens only       # a token sheet on its own
```

The default is `exclude`, so adding a section to a deck never changes what an
existing command prints. The web app's print view has the same three choices.

One caveat worth knowing before you print a sheet of nine: some tokens have only
one printing and a poor scan of it. `mtgtoolbox tokens` marks those `[lowres]`,
and there is no better printing to fall back on.

## Printing preferences

Choose *which version* of each card gets printed.

```bash
mtgtoolbox print deck.md --prefer-set cmm --full-art
mtgtoolbox print deck.md --no-ub --borderless
mtgtoolbox prints "Sol Ring" --explain
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
| `--profile <name>` | use a named profile from the config file |

Precedence runs strongest first: a printing named on the decklist line, then a saved
pin, then command-line flags, then the named profile, then built-in defaults.

An explicit `avoid` outranks every positive signal — asking for no Universes Beyond
printings means it even if that printing wins on every other count, so the penalty has to
exceed the bonuses rather than merely offset one.

Save profiles in `~/.config/mtgtoolbox/config.json`:

```bash
mtgtoolbox prefs init
mtgtoolbox prefs show --profile retro
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
mtgtoolbox pin "Sol Ring" --set soc --number 427
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
`~/.config/mtgtoolbox/config.json`.

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

Card data and images are cached under `~/.cache/mtgtoolbox` (or `$XDG_CACHE_HOME`), so
re-printing a deck needs no network at all.

```bash
mtgtoolbox cache info
mtgtoolbox cache clear images
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
