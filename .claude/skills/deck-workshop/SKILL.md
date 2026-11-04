---
name: deck-workshop
description: Build a Magic Commander deck with Drew through the mtgproxy workshop UI — he picks the commander, the cards he already wants and the theme in a browser, you propose the other ninety, he cuts and comments, repeat until he accepts. Use this whenever he asks to build, start, design or upgrade a deck with this tool, mentions a commander by name and wants a deck around it, or says "let's build a deck" / "deck workshop" / "new deck". Not for printing or syncing an existing decklist.
---

# Deck workshop

A deck gets built by two people taking turns over one session file. He describes
the deck and picks cards in a browser page; you fill in the rest; he cuts and
comments on what you proposed; you revise. The page is how he picks cards —
never ask him to type card names into the chat.

## 1. Start the workshop

Pick a slug from what he is building (`thranduil-elf`, `rats`), then start the
server **in the background** and read the URL out of its log:

```bash
mkdir -p .workshop/<slug> && node apps/cli/dist/index.js workshop start <slug> --title "<Deck name>" > .workshop/<slug>/server.log 2>&1 &
```

Use `run_in_background: true`. Wait a second, then `head -1
.workshop/<slug>/server.log` for the URL.

**The port is always ephemeral.** `workshop start` defaults to `--port 0` and
the OS picks a free one, because he usually has other sessions running with
their own servers. Never pass a fixed port, never add it to `.claude/launch.json`,
never reuse 5173/5174/5273.

Give him the URL in chat, and open it in the browser pane with `preview_start
{url}` so he can work without leaving the app. Then say what the page is for in
one line and stop talking — he is typing into it, not reading chat.

If the CLI is not built yet: `pnpm --filter @mtgproxy/cli build`.

## 2. Wait for the brief

```bash
node apps/cli/dist/index.js workshop wait <slug>
```

Run it with `run_in_background: true`: it exits the moment it is your turn, and
you get one notification. It blocks on `briefed`, `reviewed` and `accepted` —
every phase that is yours. Do not poll the file in a loop yourself.

Then read what he said:

```bash
node apps/cli/dist/index.js workshop show <slug>
```

## 3. Build the list

Use the `commander-deck-builder` skill for the actual deck-building craft —
roles, curve, the land count, what a commander wants. On top of it:

- His standing preferences apply unless the brief overrides them: bracket 3 or
  below, theming over raw power, high-fantasy painted art, no novelty printings.
- The brief's **must include** list is not a suggestion. Every card on it is in
  the deck, or you say in chat why it cannot be and let him decide.
- The **keep out** list is absolute.
- Ask real questions in chat whenever the brief is ambiguous — that is the
  normal harness and he expects it. Put questions in the proposal only when they
  are about cards he is looking at.

## 4. Propose a round

Write `.workshop/<slug>/proposal.json`, then run `workshop propose <slug>`.
`mtgproxy workshop propose --example` prints the shape. In short:

```json
{
  "summary": "What the deck does, what changed this round, what you left out and why.",
  "questions": [{ "id": "finish", "text": "Combo finish or attack?", "options": ["combo", "attack"] }],
  "cards": [
    { "name": "Thranduil, the Elvenking", "role": "Commander", "note": "why it is here" },
    { "name": "Forest", "role": "Lands", "quantity": 9 }
  ]
}
```

- `role` groups the review screen. Use real jobs: Commander, Ramp, Card draw,
  Removal, Creatures, Payoffs, Lands.
- `note` is why the card is in the deck, in one line. He cuts cards off these,
  so write them for a reader deciding, not as filler.
- Leave `set`/`collectorNumber` out. An unpinned card lets the preference
  profile choose the printing at sync time, which is where the art decision
  belongs. Pin one only when the specific printing is the point.
- `propose` looks every card up, so it reports cards that do not exist, the
  bracket, the curve and the land count. Read its output: a bracket above the
  brief's ceiling is a problem to fix now, not after he sees it.

The page he has open switches to the review screen on its own. Tell him it is
ready, in one line.

If you then find a mistake in what you proposed — a wrong note, a miscount, a
card that does not do what you said — fix `proposal.json` and run `propose
--replace`. It corrects the round in place. A second plain `propose` would bump
the round as though his cuts had been acted on, and would delete the review he
is part-way through writing, answers included.

## 5. Read the review, then go again

`workshop wait <slug>` again, then `workshop show <slug>`. The review gives you
cuts with reasons, comments on cards he kept, answers to your questions and
overall notes. Replace every cut card — a round where the deck shrank is not a
round. Comments on kept cards are the most useful thing in the file: they tell
you what the deck is actually for.

Then write the next `proposal.json` and `propose` again. Rounds are numbered for
you; send the whole list each time, not a diff.

## 6. When he accepts

```bash
node apps/cli/dist/index.js workshop export <slug>        # writes examples/<slug>.txt
node apps/cli/dist/index.js sync examples/<slug>.txt      # background: one request per card
node apps/cli/dist/index.js sync                          # bare, rebuilds the whole index
```

A single-file `sync` rewrites `decks.index.json` with only that deck, so the
bare run afterwards is not optional. Then do the art pass, which is the part
that matters for a deck that gets printed:

- `resolve examples/<slug>.txt` and read the chosen printings.
- Replace every Secret Lair (SLD/SLZ/SLC) and every crossover printing.
- Clear the `lowres image` warnings — LTC/LTR Middle-earth printings are often
  low-res and usually have a high-res twin in HOC or the original set.
- Pin the replacements with the `(SET) NUM` suffix in the decklist, then
  `sync --force`.

Finally stop the workshop server (it is still running in the background).

## Notes

- The session file is `.workshop/<slug>/session.json`. Both of you write it: he
  writes the brief and the review through the server, you write the proposal
  through `propose`. Do not hand-edit the parts that are his.
- `workshop list` shows every session and whose turn it is.
- He can reopen a brief after sending it, so a `briefed` session can go back to
  `intake`. If `wait` returns and `show` says `intake`, just wait again.
