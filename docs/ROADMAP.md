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
| Print only what is unprinted | Collection diff is reusable as-is | A second ledger, a flag, a way to record |
| Token sheets | Parser section + resolution **already work** | Exclude tokens from deck counts; auto-discovery |

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

## 5. Print only the cards you have not printed yet

**Status: the diff engine already does this; it is pointed at the wrong ledger.**

`--missing-only` answers "which cards do I not **own**". The question when
proxying is "which cards have I not **printed**", and those are different facts:
you can own a card and still want a proxy for a second deck, and you can have
printed a proxy for a card you have never owned. Today there is one ledger and
it answers the first question only.

**What already works.** `diffDeck()` and `missingOnly()` in
[`packages/core/src/collection/diff.ts`](../packages/core/src/collection/diff.ts)
are ledger-agnostic — they take a `Collection` and a resolved deck and allocate
copies, consuming each physical copy once so two rows cannot both claim it. The
positional row pairing is already correct for the awkward case this feature
hits hardest: nine copies of a card each pinned to a different art stay nine
separate rows rather than collapsing into one. None of that needs changing.

### Option A — works today, no code

`collectionPath()` already honours `--collection/-c` and `MTGPROXY_COLLECTION`.
So a second ledger is just a second file:

```bash
mtgproxy print examples/nazgul.txt -m -c ~/.config/mtgproxy/printed.json
```

Record what you printed by importing the deck into that file with the existing
CSV/ManaBox importers, or by hand. **Use this first** — it costs nothing and
will tell you whether the workflow is what you actually want before any code
gets written.

Its limits are real, though: you cannot filter on owned *and* printed in one
run, and `preferOwned` scoring starts favouring printings you have printed
(which is arguably correct, but it is a side effect, not a decision).

### Option B — a real `printed` ledger *(recommended)*

**Where:** `printedPath()` in
[`packages/node/src/paths.ts`](../packages/node/src/paths.ts) (`printed.json`
beside `collection.json`, env `MTGPROXY_PRINTED`), `loadPrinted()`/
`savePrinted()` in [`files.ts`](../packages/node/src/files.ts), and a
`-u/--unprinted` flag on `print` next to `-m`.

The schema is identical to `Collection`, so reuse `CollectionSchema` rather than
defining a parallel type. One behavioural difference is worth making deliberate:

| | `collection.json` | `printed.json` |
|---|---|---|
| `strictPrinting` default | `false` — any printing counts | **`true`** — you printed *that* art |
| `assumeBasics` default | `true` — nobody proxies basics | **`false`** — a proxy deck needs its basics |

`--unprinted` and `--missing-only` should stack, because "don't own it and
haven't printed it" is the question that actually selects a print run.

**Recording is the part that needs a decision.** Do not auto-record on every
`print`: a test render at `-q normal` would silently mark cards as printed. Make
it explicit, so a failed or discarded print run leaves no trace:

- `print --unprinted --record` — append to the ledger only after the PDF is
  written successfully
- `printed show` / `printed add <deck>` / `printed remove <deck>` /
  `printed clear`, mirroring the existing `prefs` command group

**Genuinely unresolved:**

- **Reprints.** Losing or ruining a card means printing it again. `printed
  remove` covers it, but there is no good automatic answer.
- **Cards shared between decks.** Print Sol Ring for deck A and deck B will skip
  it — correct if you own one copy, wrong if you want one per deck. The ledger
  counts copies, so recording per deck behaves properly; the trap is only in
  thinking of it as a set of names.
- **Option C: per-deck history** — `examples/<deck>.printed.json` beside the
  decklist, following the same pattern as `<deck>.cards.json`. This sidesteps
  cross-deck copy sharing completely and answers "what have I printed *for this
  deck*", which is probably the real question. It is more files and a second
  place for `sync` to care about, so it is worth building Option B first and
  seeing whether the shared-copy problem actually bites.

---

## 6. Token sheets

**Status: mostly already works. Three defects stop it being usable.**

This was expected to be a feature and turned out to be a bug report. Verified
against the real CLI, not inferred from the code:

```
Tokens
9 Wraith
3 Clue
```

```
9 Wraith                             TLTC 7
3 Clue                               TTRK 21
4 resolved, 0 unresolved
```

**What already works:**

- [`parse.ts`](../packages/core/src/decklist/parse.ts) already maps a `Tokens`
  header to `section: 'tokens'` and tags every line under it.
- Token names already resolve. `POST /cards/collection` returns tokens by name —
  it is only `/cards/search` that hides them behind `include:extras` — so the
  existing resolution path finds them with no change.
- **Quantities already work**, which was the whole ask: the leading number is
  the count, and the existing `(SET) NUM` pin picks the art. `9 Wraith (TLTC) 7`
  needs no new syntax.
- `TWO_FACED_LAYOUTS` in [`scryfall/types.ts`](../packages/core/src/scryfall/types.ts)
  already includes `double_faced_token`.

**Defect 1 — tokens are counted as deck cards.** `section` is read **nowhere
outside the parser**. So a 100-card deck with a token block reports 112 cards,
and the curve is wrecked: the test list above reports `14 spells, 0 lands,
average mana value 0.43`, with twelve cards in the MV 0 bucket. Fix in three
places, ideally behind one `isDeckCard(entry)` helper in `parse.ts` so the rule
lives once:

- `totalCards()` — so the 100-card note stays meaningful
- `manaCurve()` in `analysis/curve.ts` — a token has no mana value
- `assessBracket()` in `analysis/bracket.ts` — harmless today, wrong in principle
- `diffDeck()` — a token is never "owned"; exclude it rather than report it missing

**Defect 2 — no way to find out which tokens a deck needs.** Scryfall answers
this directly and it is not modelled. `all_parts` on each card lists its
tokens; Lord of the Nazgûl carries
`{component: "token", name: "Wraith", type_line: "Token Creature — Wraith"}`
with an `id`, so there is nothing to hardcode and no name guessing.

**Where:** add `all_parts` to `ScryfallCard`, then a `mtgproxy tokens <deck>`
command that walks the resolved deck, collects `all_parts` entries with
`component === 'token'`, dedupes by `id`, and prints a ready-to-paste `Tokens`
block with the counts left at 1 to edit. `--write` could append it to the
decklist. For the current Nazgûl list that surfaces Wraith, Clue (Trail of
Evidence) and Treasure (An Offer You Can't Refuse).

**Defect 3 — the art may be unprintable, and the tool should say so louder.**
The Wraith token has exactly one printing (TLTC 7) and Scryfall flags its scan
`lowres`. The resolver already warns — `Wraith (TLTC) has a lowres image and
will print poorly` — and [PLAN.md](PLAN.md) already calls this out as mattering
more than any aesthetic preference. There is no better printing to fall back to,
so the honest options are to accept it, or to allow an image override per entry.
Worth deciding before printing a sheet of nine.

**Genuinely unresolved:**

- **In-list or sidecar?** Keeping tokens in the decklist is simpler and the
  parser already supports it, but it is what forces every filter in Defect 1. A
  sidecar (`examples/<deck>.tokens.txt`) needs **none** of those changes and
  keeps the 100-card list pristine. This is the real fork in the road, and the
  sidecar is the smaller change — the argument for in-list is that one file per
  deck is easier to keep in sync by hand.
- **A `--tokens-only` flag on `print`**, since token counts and deck counts
  rarely want to be on the same sheet.
- **Token printing preferences.** `avoidSetTypes` includes `'token'` in the
  default profile, a -200 penalty that is right for real cards and wrong for
  token entries. It does not currently break anything, because token names
  mostly have no competing real card — but `1 Angel` or `1 Soldier` would pick
  the real card over the token. A per-entry override (require `layout:token` for
  the tokens section) is a few lines where `printing/resolve.ts` builds its
  scoring context.
