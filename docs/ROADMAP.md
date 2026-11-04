# Roadmap

Features that are designed but not built. Each entry says where the code goes,
what data it needs, and what is genuinely unresolved — so the work can start
without re-deriving the design.

For the architecture these plug into, see [PLAN.md](PLAN.md).

## Status of the groundwork

| Feature | Groundwork done | Still to build |
|---|---|---|
| GitHub Pages hosting | Workflow written, `base` already relative | Enable Pages in repo settings |
| Export to Moxfield | Parser already reads the target format | Exporter, UI entry point |
| Mana curve | **done** | — |
| Deck bracket | **done** | — |
| Print only what is unprinted | **done** | — |
| Token sheets | **done** | — |

---

## 1. Hosting on GitHub Pages

**Status: ready, needs one setting.**

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds `apps/web`
and deploys it on every push to `main`. It typechecks and tests first, so a
broken build never publishes.

The only manual step is in the repository settings:
**Settings → Pages → Build and deployment → Source: GitHub Actions.**
The workflow fails without it, because no Pages environment exists to deploy to.

Why this works with no backend: the app talks to Scryfall directly (both
`api.scryfall.com` and `cards.scryfall.io` send `Access-Control-Allow-Origin: *`),
and falls back to IndexedDB when no local server answers `/api/health`. A Pages
deployment is simply the no-server half of that split.

`vite.config.ts` already sets `base: './'`, which is what makes the build work
from a project-site subpath (`user.github.io/mtg/`) as well as from a root.

**Watch out for:** the bundled decklists are inlined at build time, so a deck
added to `examples/` only appears on the hosted site after a redeploy. That is
the intended tradeoff — it keeps the deck list working with no filesystem.

---

## 2. Export to Moxfield

**Where:** `packages/core/src/export/moxfield.ts`, plus a button in
`DeckDetailView` and the print view.

Moxfield has no public write API for creating decks, so "export" means
producing text for its bulk import box, offered as a copy-to-clipboard action
and a `.txt` download.

The good news is the target format is the one the parser already reads:

```
1 Sol Ring (LTC) 264
9 Nazgûl (LTR) 332
```

So the exporter is close to the inverse of `parseDecklist`, and the two should
be tested as a round trip: parse, export, re-parse, expect the same entries.

**Design decisions to make:**

- **Which printing to emit.** Exporting the resolved printing carries your art
  choices across; exporting bare names keeps the list portable and lets Moxfield
  pick. Probably an option, defaulting to including printings.
- **Split copies.** A card split across several artworks has to emit one line
  per distinct printing (`1 Nazgûl (LTR) 332` ×8, `1 Nazgûl (LTR) 100`), not a
  single stacked line. The slot model in `apps/web/src/resolve.ts` already
  produces exactly this shape — `slotsToCards` output groups naturally.
- **Commanders.** Moxfield wants them under a `Commander` header. The parser
  now tags entries with `section`, so this information survives.

**Gotcha:** Moxfield matches set codes case-insensitively but is strict about
collector numbers, and Scryfall's collector numbers for promos and variants
(`123a`, `★`) do not always match what Moxfield expects. Fall back to the plain
name when a printing fails to import rather than silently dropping the card.

---

## 3. Mana curve — built

Lives in `packages/core/src/analysis/curve.ts` with the front-face helpers in
`analysis/mana.ts`, charted by `ManaCurveChart` and printed by `mtgproxy curve`.

Two things found while building it, both of which would have produced a wrong
chart: a modal double-faced card's combined type line reads `Instant // Land`,
so a naive land test drops a castable spell; and Scryfall reports a split card's
`cmc` as the **sum** of both halves (Dusk // Dawn is 9), so the front half's
cost has to be computed instead. Both are covered by tests.

The original design notes follow.

**Where:** `packages/core/src/analysis/curve.ts`, rendered in `DeckDetailView`.

`cmc` is now on the card type, so the data is in hand — no extra requests.

```ts
export interface CurveBucket { mv: number | '7+'; count: number; cards: string[] }
export function manaCurve(cards: readonly ResolvedCard[]): CurveBucket[]
```

Rules that matter for it to be useful rather than merely correct:

- **Exclude lands.** A curve including 38 lands at MV 0 tells you nothing. Use
  the same `isBasicLand`-style type-line check already in `collection/diff.ts`.
- **Bucket 7 and above together.** Individual buckets past 7 are noise.
- **Count copies, not entries.** Nine copies of one card are nine cards.
- **Double-faced cards** should use the front face's mana value; an MDFC land
  counts as a spell at its front-face cost, which is the honest reading since
  that is the only cost you can pay proactively.

**The interesting part is the caveat, not the chart.** A printed curve misleads
whenever a deck cheats costs — rituals, cost reduction, reanimation, free
spells. The commander-deck-builder skill already writes a sentence on effective
versus printed curve; the UI should show the same distinction rather than
presenting the histogram as the whole truth. Consider flagging cards whose
effective cost differs (cost reducers present, `Cascade`, `Suspend`, etc.).

---

## 4. Deck bracket, and why — built

Lives in `packages/core/src/analysis/bracket.ts`, shown by `BracketPanel` and
printed by `mtgproxy bracket`.

Checking the current criteria before building — as the note below insisted —
paid off twice. **Tutor limits were removed in the October 2025 update**, so the
tutor criterion listed below is stale and is deliberately not implemented. And
Scryfall's `game_changer` flag means the Game Changers list never has to be
checked into this repo at all: `is:gamechanger` returns 53 cards, matching the
published count, and it stays current on its own.

Validated against real decks: both Secrets of Strixhaven precons assess as
bracket 2, which is what precons are built to be, and the Rats deck lands at 3
on the strength of a single Game Changer.

Combo detection remains unbuilt and is reported as unchecked rather than
guessed at. Option 3 below — Commander Spellbook — is still the right answer if
it is ever wanted.

The original design notes follow.

**Where:** `packages/core/src/analysis/bracket.ts`, rendered in `DeckDetailView`.

The Commander bracket system sorts decks 1–5 (roughly: exhibition, core,
upgraded, optimised, cEDH). The value here is the *explanation* — naming the
cards that drove the number — not the number on its own.

**What is directly available.** Scryfall exposes `game_changer` per card, now on
the card type, verified true for cards such as Rhystic Study. Counting Game
Changers is the single most mechanical input and should be built first.

**What is not.** The other criteria — mass land denial, extra-turn chains,
tutors, and two-card infinite combos — have no Scryfall flag. Options, in
increasing order of effort:

1. A curated list in the repo, keyed by oracle id. Honest, easy to correct,
   goes stale.
2. Oracle-text heuristics (`/take an extra turn/i`, `/search your library/i`).
   Cheap and catches most cases, but will misfire on cards that only conditionally
   qualify.
3. Combo detection via an external database (Commander Spellbook has an API).
   Much the most accurate for the two-card-combo criterion, at the cost of a
   dependency and another network call.

Start with 1 and 2, and treat the result as an estimate the user can override.

**Be honest in the UI.** Report the bracket as an assessment with reasons and an
explicit list of what could not be checked automatically, rather than as a
verdict. A confidently wrong bracket is worse than an obviously partial one,
because it is the number people quote at a table.

**Before implementing:** re-check the current official criteria and the Game
Changers list rather than trusting anything written here or in training data —
both have changed several times since the system was introduced.

---

## 5. Print only the cards you have not printed yet — built

The "owned collection" is gone. What the tool tracks now is what has come out of
the printer, which is the question a proxy generator actually has.

**Where:** `packages/core/src/printed/` (`types.ts`, `ledger.ts`, `diff.ts`),
`printedPath()` / `loadPrinted()` / `savePrinted()` in `@mtgproxy/node`,
`apps/cli/src/printed-cmd.ts`, and the **Printed** tab in the web app.

The ledger lives at `~/.config/mtgproxy/printed.json` (`--printed`,
`$MTGPROXY_PRINTED`). `print --unprinted` drops what is already in it;
`print --record` adds what was printed, writing **after** the PDF lands so a run
that failed earlier cannot claim those cards exist. `mtgproxy printed` has
`list`, `path` and `clear --yes`, and nothing else: entries come from a print
run, because a ledger that disagrees with the printer is worse than none.

Two defaults are the opposite of what an ownership check wanted, and both are
deliberate:

| | was (owned) | is (printed) |
|---|---|---|
| `strictPrinting` | `false` | **`true`** — you printed *that* art |
| `assumeBasics` | `true` | **`false`** — a proxy deck needs its basics |

**What was removed with it:** the ManaBox/CSV importers and exporters, the
`preferOwned` printing preference and its score weight, the collection's
`add`/`remove`/`search`/`stats` subcommands, and the stored-deck-data `owned`
fingerprint — which only existed because `preferOwned` let ownership change
which printing won. The printed ledger is deliberately *not* fingerprinted into
stored deck data or the web app's resolution cache: what you have printed cannot
change which printing is correct, so recording a print must not invalidate every
cached deck.

**Still open:** there is no way to un-record a single mis-recorded row from the
CLI — `clear` is all-or-nothing, though `removeEntry` is in core ready for it.
And a card printed for deck A is skipped for deck B, which is right if you own
one copy and wrong if you want one per deck; per-deck history
(`examples/<deck>.printed.json`) is the fix if that turns out to bite.

---

## 6. Token sheets — built

Mostly a bug report, as it turned out: a `Tokens` section already parsed, and
token names already resolved. What did not work was everything around them.

**Where:** `isTokenEntry` / `isDeckCard` / `selectForTokenMode` / `totalTokens`
in `decklist/parse.ts`, `setTokensSection` in `decklist/tokens.ts`,
`tokenParts` and `all_parts` in `scryfall/types.ts`, the `tokens` command in the
CLI, and a Tokens select in the web print view.

**Tokens no longer count as deck cards.** `section` was read nowhere outside the
parser, so a 100-card deck with a token block reported 112 cards and the curve
put every token in the MV 0 bucket. `totalCards`, `manaCurve` and
`assessBracket` now filter through `isDeckCard`, as does the deck index — whose
figures would otherwise contradict its own `cardCount`.

**A three-way mode, defaulting to `exclude`,** so adding a section to a deck
cannot change what an existing command prints: `--tokens exclude|include|only`
on the CLI, the same three choices in the print view. `sync` stores token
printings regardless, so every mode is served from the file rather than the
network.

**Token entries resolve against token printings only.** `/cards/search` hides
tokens unless the query says `include:extras`, so before this a token name fell
through to the fuzzy single-card fallback and arrived with exactly one candidate
— no choice of art, and an extra request. `prints(name, { extras: true })` now
fetches them properly, filtered to `layout: token` so a real card of the same
name cannot win a token's slot.

**Discovery comes from Scryfall, with nothing hardcoded.** `mtgproxy tokens
<deck>` walks the resolved deck's `all_parts`, keeps the `token` components,
dedupes by name and printed stats, and prints a ready-to-paste section;
`--write` puts it in the decklist. Printings are pinned on the written lines,
because token names collide — several Wraiths exist and only one is the 3/3 with
menace.

**Still open:** some token art is poor and there is nothing to be done about it
from Scryfall. The Wraith token has exactly one printing and its scan is flagged
`lowres`; `tokens` marks it, and `resolve` warns, but printing a sheet of nine
will look it. An image override per entry is the only real fix.
