# Lord of the Nazgûl — Commander Deck Guide

**Commander:** Lord of the Nazgûl — {3}{U}{B}, 4/3 Legendary Creature — Wraith Noble

> *Flying. Wraiths you control have protection from Ring-bearers. Whenever you cast an
> instant or sorcery spell, create a 3/3 black Wraith creature token with menace. Then if
> you control nine or more Wraiths, Wraiths you control have base power and toughness 9/9
> until end of turn.*

Oracle text, legality, colour identity and Game Changer status for every card named in this
guide were checked against Scryfall, not recalled.

---

## 0. Why the deck feels weak, and three ways to fix it

Measured from `examples/nazgul.txt`:

| | Current list | Rebuild (`nazgul.txt`) |
|---|---|---|
| Instants + sorceries | **27** | **36** |
| Spells at MV 1–2 | 22 | 36 |
| Average mana value (nonlands) | **3.11** | **2.45** |
| Blue land sources | **17** | **23** |
| Black land sources | **18** | **24** |
| Lands making no coloured mana | 4 | 0 |
| Mass evasion | 1 (Akroma's Memorial, 7 mana) | 3 (Cover of Darkness, Levitation, Wonder) |
| Game Changers → bracket | **4 → bracket 4** | **3 → bracket 3** |

Two separate problems, and they have nothing to do with each other.

**The bracket 4 is a bookkeeping accident.** Nothing about how the deck plays puts it at 4.
It has no mass land denial, no extra turns and no fast combo. It is a 4 purely because it
runs **four** Game Changers — Cyclonic Rift, Fierce Guardianship, Mystical Tutor and The One
Ring — and bracket 3 permits at most three. **Cutting any single one of those four makes it a
bracket 3 deck today**, with no other change. Cut Mystical Tutor: it is the weakest of the
four here, because the deck has no single bomb worth tutoring for and the card costs you a
card to find one.

**The weakness is a different thing, and it is structural.** The deck is two decks sharing a
sleeve. One is a Nazgûl/Ring-tempt list. The other is a blink-and-clone list — Panharmonicon,
Starfield Vocalist, Conjurer's Closet, Thassa, Displace, Ghostly Flicker, Illusionist's
Stratagem, Hide on the Ceiling, Impostor Syndrome, Naga Fleshcrafter, Deceptive Frostkite,
Orvar, Gogo, Cackling Counterpart, Rite of Replication, Unstoppable Plan and The Ozolith.
That is **17 cards built to abuse enter-the-battlefield triggers in a deck with three ETB
triggers worth abusing** (Nazgûl, Ringwraiths, Witch-king of Angmar).

And the commander does not care about ETBs at all. It triggers on **casting** an instant or
sorcery. Ghostly Flicker makes a Wraith because you cast it, not because it blinks anything —
so you are paying three mana for a trigger that Opt gives you for one. Those 17 slots are the
weakness. They crowd out the cheap spells the commander actually converts into a board.

### The three options

| | What it is | Cards changed | Bracket | Pick this if |
|---|---|---|---|---|
| **A — Tune** | Keep the list and the mana base; replace the 14 worst cards | **14** | 4 → **3** | You want it fixed this week with 14 new proxies |
| **B — Rebuild** *(recommended)* | Same commander, same 9 Nazgûl, same Ring-tempt core; the engine and mana base rebuilt around casting spells | **45** | 4 → **3** | You want the deck to actually win games |
| **C — Bracket 2** | Option B with the three remaining Game Changers swapped out | 48 | 4 → **2** | Your table plays precons and you want to bring this to it |

Option B is written out below and is now the list in `examples/nazgul.txt`. Options A and C are
exact swap lists in [section 7](#7-upgrade-paths).

---

## 1. The rules that decide every card choice

1. **The token comes from casting, not from resolving.** Counter the spell, fizzle it, cast it
   for no reason at all — you still get the 3/3. Counterspells and cantrips are *full-rate*
   engine pieces, and an expensive spell is worth no more Wraiths than a cheap one.

2. **Therefore cheap beats strong, always.** Two one-mana spells make two Wraiths; one
   two-mana spell makes one. The metric that decides this deck is spells cast per turn, so the
   build targets 36 instants and sorceries at an average mana value near 2, not 27 at 3.11.

3. **Instants beat sorceries, because tokens have no haste.** A Wraith made on your own turn
   cannot attack that turn. A Wraith made in the *last opponent's end step* attacks
   immediately. This is why the rebuild runs 25 instants to 11 sorceries, and why the correct
   default is to hold your cheap spells until the end step before your turn.

4. **The 9/9 clause is a combat trick, not a board state.** It lasts until end of turn and it
   is re-checked on *every single cast*. So: attack with eight Wraiths, let your opponents
   declare blocks, **then** cast a one-mana instant. You get the ninth Wraith and every
   attacker becomes a 9/9 after blockers are locked in. That blowout is how this deck wins, and
   the current list has almost no cheap instants to do it with.

5. **You need nine Wraiths, not nine tokens.** The commander is a Wraith. So are all nine
   Nazgûl, Ringwraiths and both Witch-kings. Hitting nine is not the hard part — getting nine
   bodies *through blockers* is, and the current list has one answer to that and it costs seven
   mana.

6. **Base 9/9 sets the floor; +1/+1 counters still add on top.** Each Nazgûl is only a 1/2, but
   every Ring-tempt puts a counter on *each* Wraith you control. Four tempts across a game and
   you are attacking with 13/13s. This is the real reason to run nine Nazgûl and the cheap
   Ring-tempt spells — not the bodies, the counters.

7. **A copy is not a cast.** Rite of Replication's tokens, Cackling Counterpart's copy, Mirari
   and Narset's Reversal's copy do **not** trigger the commander. Flashback, rebound and
   casting from the graveyard **do**. That one line is why Ojer Pakpatiq (rebound on every
   instant from hand = two casts = two Wraiths) is near the top of the deck and Rite of
   Replication is near the bottom.

8. **"Protection from Ring-bearers" is not a build-around.** It does something only when an
   opponent has chosen a Ring-bearer. Build as though the line were not printed.

---

## 2. Ranked card list

### S — the deck does not work without these

| # | Card | MV | Why |
|---|---|---|---|
| 1 | Archmage of Runes | 5 | Every instant and sorcery costs {1} less *and* draws a card. It turns the commander's trigger into a draw engine and pays for the next spell. |
| 2 | Nazgûl ×9 | 3 | Nine legal copies. Each one is a Wraith for the threshold and each ETB tempts the Ring, putting a +1/+1 counter on *every* Wraith you control. |
| 3 | Ojer Pakpatiq, Deepest Epoch | 4 | Rebound on every instant cast from hand. A cast from exile is a cast: two Wraiths per instant, and the second one arrives on your upkeep, untapped and able to attack. |
| 4 | Cover of Darkness | 2 | Choose Wraith: every Wraith you control gains fear. Two mana to turn a stalled board of 9/9s into lethal — the job Akroma's Memorial was doing for seven. Caveat: fear is still blocked by black and artifact creatures, which is why Levitation is in the deck as well. |
| 5 | The One Ring | 4 | **Game Changer.** The deck empties its hand by design; this refills it. The protection-from-everything turn also buys you one safe turn to set up — it shields you, not your attackers. |
| 6 | Talrand, Sky Summoner | 4 | A second token per cast, and drakes fly. Two bodies per spell is the difference between a slow deck and a fast one. |
| 7 | Cyclonic Rift | 2 | **Game Changer.** Overloaded, it is "no blockers this turn" for a board that is already lethal. |

### A — the engine and the way it converts

| # | Card | MV | Why |
|---|---|---|---|
| 8 | Sapphire Medallion / Jet Medallion | 2 | Roughly "one extra Wraith per turn" each. Jet matters more than it looks: nine Nazgûl are black spells. |
| 9 | Jace's Sanctum | 4 | Cost reduction plus a scry on every cast, which fixes the deck's one real consistency problem. |
| 10 | Rona, Sheoldred's Faithful | 4 | Each opponent loses 1 life per instant or sorcery. Three spells a turn drains 3 from *each* opponent — 9 life off the table per turn, and no blocker stops any of it. The deck's answer to a board stall. |
| 11 | Levitation | 4 | Second copy of mass evasion, and it works on the drakes and non-Wraiths too. |
| 12 | Wonder | 4 | The cheapest mass flying in the format — from the graveyard. Needs an outlet; the deck now has four (Frantic Search, Consider, Unearth's cycling, Undercity Sewers). |
| 13 | Frantic Search | 3 | Effectively free, untaps three lands so you keep casting, and bins Wonder. |
| 14 | Fierce Guardianship / Deadly Rollick / Snuff Out | 3–4 | **Fierce Guardianship is a Game Changer.** No mana at all: the first two are free while you control a commander, Snuff Out costs 4 life if you control a Swamp. A Wraith *and* an answer for nothing. Exactly what rule 1 asks for. |
| 15 | Dark Ritual / Cabal Ritual | 1–2 | Ramp that is itself a spell, so it makes a Wraith on the way to casting the next one. |
| 16 | Trail of Evidence / Reconnaissance Mission | 3–4 | Card advantage keyed to the two things this deck does anyway: casting spells and connecting with a wide board. |
| 17 | The cantrip pack — Brainstorm, Opt, Consider, Ponder, Preordain, Serum Visions, Birthday Escape | 1 | Seven one-mana Wraiths that replace themselves. This is the engine, not filler. |
| 18 | Ring-tempt cheap spells — Gollum's Bite, Soothing of Sméagol, Sam's Desperate Rescue, Claim the Precious, Ringsight, Call of the Ring | 1–3 | Each does a job *and* puts a counter on every Wraith. Call of the Ring tempts every upkeep for free. |
| 19 | Witch-king, Bringer of Ruin | 6 | A flier that strips a blocker every time it attacks. The only six-drop that earned its slot. |

### B — interaction, which is also engine fuel

| # | Card | MV | Why |
|---|---|---|---|
| 20 | Counterspell, Arcane Denial, Negate, Dispel, Swan Song, An Offer You Can't Refuse | 1–2 | Protect the alpha strike. Every one of them makes a Wraith when you cast it, so holding up interaction costs you nothing. |
| 21 | Go for the Throat, Infernal Grasp, Bitter Triumph, Tragic Slip, Saw in Half | 1–3 | Cheap instant-speed removal to clear the one blocker that matters. |
| 22 | Village Rites | 1 | Spare tokens become two cards. The deck makes more bodies than it can profitably attack with. |
| 23 | Victimize, Unearth, Deep Analysis | 1–4 | Rebuy Archmage or Talrand after a wipe. Deep Analysis's flashback is a second cast, so a second Wraith. |
| 24 | Slip Out the Back | 1 | One mana to save the commander from targeted removal. |
| 25 | Night's Whisper | 2 | Two cards for two mana and a Wraith. |

### Traps — popular or plausible here, and wrong

- **The whole blink package** — Ghostly Flicker, Displace, Illusionist's Stratagem, Hide on the
  Ceiling, Conjurer's Closet, Thassa, Panharmonicon, Starfield Vocalist. The commander triggers
  on **cast**. These spells make a Wraith because you cast them; the blink itself is worth
  nothing, because the deck has three ETB triggers. You are paying 3–5 mana for the trigger that
  Opt gives you for 1. **This is the single biggest cut in the deck.**
- **Copy effects** — Rite of Replication, Cackling Counterpart, Orvar the All-Form, Gogo Master
  of Mimicry, Naga Fleshcrafter, Deceptive Frostkite, Impostor Syndrome. A copy is not a cast
  (rule 7), so none of them make an extra Wraith. Orvar and Gogo are commanders in their own
  right; as 99-cards here they do close to nothing.
- **Akroma's Memorial (7) and Rise of the Dark Realms (9)** — in a deck with no real ramp these
  are cards you lose with still in hand. Cover of Darkness does Memorial's only relevant job for
  two mana.
- **Mystical Tutor** — card disadvantage in a deck with no bomb to find, *and* it is the Game
  Changer that costs least to lose. Cut it first.
- **Cancel** — a strictly worse Counterspell. There is no reason to run both.
- **Wonder with no outlet** — the current list runs Wonder and has zero discard or self-mill, so
  it only ever works if Wonder dies in combat. Great card; it needed one of four other cards to
  function.
- **In the Darkness Bind Them** and **Saruman, the White Hand** — the first two cards you find
  searching for Nazgûl synergies. Both literally make Wraith or Army tokens. Both are **Grixis
  ({U}{B}{R})** and illegal in this deck. Checked, not assumed.
- **Thing in the Ice** — looks like a perfect four-spell payoff; flipping it returns all
  non-Horror creatures to hand, which destroys every token you own.
- **Argonath, Pillars of the Kings** — this is a *flavour-name printing of The Ozolith* (LTC
  #351). It resolves fine in mtgproxy, but its ability needs creatures leaving the battlefield
  with counters on them, which this deck does not do on purpose. If you ever paste the list into
  a site that is not mtgproxy, use "The Ozolith".

---

## 3. The 99

**Wraith count and Ring-tempt counters (10)**
Nazgûl ×9 · Witch-king, Bringer of Ruin

**Engine creatures (5)**
Archmage of Runes · Talrand, Sky Summoner · Ojer Pakpatiq, Deepest Epoch ·
Rona, Sheoldred's Faithful · Wonder

**Cast payoffs, evasion and draw engines (7)**
Trail of Evidence · Jace's Sanctum · Cover of Darkness · Levitation ·
Reconnaissance Mission · Call of the Ring · The One Ring

**Mana (7)**
Sol Ring · Arcane Signet · Dimir Signet · Talisman of Dominance · Fellwar Stone ·
Sapphire Medallion · Jet Medallion

**One-mana spells (17)**
Brainstorm · Opt · Consider · Ponder · Preordain · Serum Visions · Birthday Escape ·
An Offer You Can't Refuse · Swan Song · Dispel · Slip Out the Back · Gollum's Bite ·
Tragic Slip · Village Rites · Sam's Desperate Rescue · Dark Ritual · Unearth

**Two- and three-mana spells (16)**
Counterspell · Arcane Denial · Negate · Cyclonic Rift · Go for the Throat ·
Infernal Grasp · Bitter Triumph · Soothing of Sméagol · Night's Whisper · Cabal Ritual ·
Frantic Search · Claim the Precious · Ringsight · Victimize · Saw in Half · Deep Analysis

**Free spells (3)**
Fierce Guardianship · Deadly Rollick · Snuff Out

**Lands (34)**
Command Tower · Sunken Hollow · Underground River · Choked Estuary · Drowned Catacomb ·
Morphic Pool · Darkslick Shores · River of Tears · Shipwreck Marsh · Temple of Deceit ·
Clearwater Pathway · Undercity Sewers · Fetid Pools · Darkwater Catacombs · Mystic Sanctuary ·
Witch's Cottage · Bojuka Bog · Otawara, Soaring City · Takenuma, Abandoned Mire ·
Minas Morgul, Dark Fortress · Island ×7 · Swamp ×7

10 + 5 + 7 + 7 + 17 + 16 + 3 + 34 = **99**, plus Lord of the Nazgûl = **100**.

---

## 4. Mana curve

Nonland cards, commander included (66 cards):

| MV | Count | Bar |
|---|---|---|
| 1 | 18 | `##################` |
| 2 | 18 | `##################` |
| 3 | 16 | `################` |
| 4 | 11 | `###########` |
| 5 | 2 | `##` |
| 6 | 1 | `#` |

**Average mana value 2.45**, down from 3.11. There is nothing above six.

The shape this deck wants is a wall at one and two and almost nothing above four, because the
win comes from casting *three or four spells in a turn*, not from resolving one good one. The
current list's curve peaks at **three** with 21 cards — that peak is the blink package, and it
is exactly the mana band that stops you double-spelling.

**The printed curve overstates the real cost.** Archmage of Runes and Jace's Sanctum each take
{1} off every instant and sorcery; Sapphire and Jet Medallion each take {1} off half the deck;
Fierce Guardianship and Deadly Rollick are free while you control a commander and Snuff Out
costs 4 life instead of mana; Dark Ritual and Cabal Ritual *add* mana. With one cost reducer out, the effective
curve sits closer to 1.5 and three spells a turn off five lands is routine.

---

## 5. Game plan

**Turns 1–3 — land, rock, cheap cantrip.** Do not hold cantrips for value; you have no value to
hold them for yet. Lead on Sol Ring or a two-mana rock, and use Ponder and Preordain to find
land. If you draw a cost reducer, it comes down before the commander.

**Turn 4–5 — the commander.** Five mana, or four with a reducer. Hold one of Slip Out the Back,
Swan Song or a counterspell for the removal that is coming. Losing the commander is not fatal —
nine Nazgûl and the Ring-tempt counters still do work — but it costs you two turns.

**The engine turns.** With the commander out, every cheap spell is "a 3/3 menace plus its own
effect". The sequencing that matters:

- **Cast on the end step before your turn, not on your turn.** Tokens made on an opponent's
  turn can attack. This is the single biggest play improvement available and it costs nothing.
- **Count Wraiths before you attack, not after.** You want eight on board before combat, with
  at least one one-mana instant in hand.
- **Attack, let blocks be declared, then cast.** The ninth Wraith plus base 9/9 lands after
  blockers are locked. A 3/3 menace chump-blocked by two 2/2s becomes a 9/9 that kills both and
  pushes damage through. Opponents who have seen this once will stop blocking, at which point
  you simply hit for more.
- **Then add evasion.** Cover of Darkness or Levitation turns "they have to block" into "they
  cannot block". With either one down, eight Wraiths at 9/9 is 72 damage and the table is over.

**If the board stalls.** Rona, Sheoldred's Faithful is the out: three spells a turn
drains 3 from every opponent with no combat involved. Village Rites turns surplus tokens into cards.

**Main weakness: sweepers.** A board of tokens dies to Blasphemous Act and comes back nowhere.
The mitigation is real but partial — the commander rebuilds one Wraith per cast, so you recover
faster than most token decks, and the nine Nazgûl are real cards that stay dead. Hold a
counterspell against known wipe decks rather than spending it on a ramp spell, and keep Victimize
or Unearth for Archmage or Talrand afterwards.

**Threat assessment.** Before the commander lands, this deck reads as harmless and draws no
hate — use that. After it lands with eight Wraiths out, you are the archenemy, and the turn you
cast Cover of Darkness is the turn everyone realises it. Prefer to deploy evasion *in the same
turn you attack*, not the turn before.

---

## 6. Manabase

**34 lands.** Lower than the current 36, and that is deliberate: average mana value drops from
3.11 to 2.45 and the deck gains seven mana rocks and four cost reducers. What it could not
afford was the *colour* problem. The current list has **17 blue and 18 black sources** while
asking for {U}{U} (Counterspell, Talrand), {B}{B} (Claim the Precious, the Witch-kings) and
three spells a turn — and four of its lands make no coloured mana at all.

The rebuild runs **23 blue and 24 black sources** and nothing that makes only colourless.

| Role | Lands |
|---|---|
| Untapped or near-untapped duals (10) | Command Tower, Underground River, Choked Estuary, Drowned Catacomb, Morphic Pool, Darkslick Shores, River of Tears, Shipwreck Marsh, Clearwater Pathway, Darkwater Catacombs |
| Conditional / tapped duals (4) | Sunken Hollow, Temple of Deceit, Undercity Sewers, Fetid Pools |
| Utility that still makes a colour (6) | Mystic Sanctuary, Witch's Cottage, Bojuka Bog, Otawara Soaring City, Takenuma Abandoned Mire, Minas Morgul Dark Fortress |
| Basics (14) | Island ×7, Swamp ×7 |

Notes on the picks:

- **Undercity Sewers** surveils, which is a Wonder outlet attached to a land. Small, free, real.
- **Mystic Sanctuary** and **Witch's Cottage** both need three *other* Islands or Swamps.
  Sunken Hollow, Undercity Sewers and Fetid Pools all have both land types, so both conditions
  are reachable on 14 basics — but they are the two weakest lands here and the first cuts if
  you find yourself with them tapped.
- **Otawara** and **Takenuma** are free utility: a land that is also removal or regrowth, with
  the channel cost dropping for each legendary creature you control.
- **Minas Morgul, Dark Fortress** can put a shadow counter on a creature to make it a Wraith —
  a niche way to reach nine, and it makes black mana regardless.

**Lands to skip:** the four colourless utility lands in the current build. Bonders' Enclave,
Rogue's Passage, Secret Tunnel and Myriad Landscape are each fine in a vacuum, but a two-colour
deck casting three spells a turn cannot spare four colourless lands — and Cover of Darkness and
Levitation make *everything* unblockable, which is strictly better than Rogue's Passage making
one creature unblockable for four mana.

---

## 7. Upgrade paths

### Option A — the 14-card tune (keeps the current mana base)

If you want this fixed without re-proxying half the deck. Instants and sorceries go 27 → 34,
average mana value drops to roughly 2.7, mass evasion arrives, and the deck becomes a bracket 3.

| Out | In | Why |
|---|---|---|
| Mystical Tutor | Brainstorm | **The bracket fix.** Four Game Changers → three. |
| Panharmonicon | Opt | No ETB density to double. |
| Starfield Vocalist | Consider | Same, and Consider bins Wonder. |
| Conjurer's Closet | Preordain | Five mana to blink nothing. |
| Thassa, Deep-Dwelling | Serum Visions | Same. |
| Ghostly Flicker | Cover of Darkness | Three mana for a trigger Opt gives for one; Cover is the win condition. |
| Displace | Levitation | Same trade. |
| Illusionist's Stratagem | Talrand, Sky Summoner | Two bodies per spell instead of one. |
| Hide on the Ceiling | Frantic Search | Free, untaps lands, discards Wonder. |
| Impostor Syndrome | Trail of Evidence | Six mana that needs combat damage first. |
| Akroma's Memorial | Infernal Grasp | Seven mana; Cover of Darkness does the job for two. |
| Rise of the Dark Realms | Cabal Ritual | Nine mana in a deck with no ramp. |
| Argonath, Pillars of the Kings | Dimir Signet | The Ozolith has no counters to move here. |
| Cancel | Sapphire Medallion | Strictly worse Counterspell. |

### Option C — bracket 2 (no Game Changers)

Take the rebuild and make three more swaps. Nothing else changes.

| Out | In | Why |
|---|---|---|
| Cyclonic Rift | The Black Breath | {2}{B}: opponents' creatures get -1/-1 *and* the Ring tempts you. Sweeps the chump blockers Rift was bouncing, and adds a counter to every Wraith. |
| Fierce Guardianship | Mystic Remora | {U} for an enormous early draw engine — and confirmed *not* on the Game Changers list. |
| The One Ring | Murmuring Mystic | A third token-per-cast engine on a 1/5 body that actually protects you while you set up. |

This is a genuinely weaker deck, not a sidegrade — you lose the free counterspell, the best
draw engine in the format, and the "nobody blocks this turn" button. It is still the stronger
*deck* than the current bracket 4 list, because the engine works.

### Further directions, grouped by goal

- **Speed.** Primal Amulet, Case of the Ransacked Lab (both cut {1} off every spell);
  Bubbling Muck; a second Talisman.
- **Consistency.** Gale, Waterdeep Prodigy — cast an instant from hand, then cast a sorcery
  from your graveyard: a free extra cast, so a free extra Wraith, every turn.
- **Resilience.** Dictate of Erebos (flash; with nine expendable Wraiths dying it strips three
  boards), Swiftfoot Boots back in for the commander, Street Wraith (a free draw that is also a
  Wraith).
- **Reach.** Metallurgic Summonings, Docent of Perfection, Maskwood Nexus (every creature you
  control becomes a Wraith, so drakes and Archmage count toward nine and become 9/9 too).
- **Do not go here.** Extra turns and mass land denial are the two patterns that put a deck in
  bracket 4 on *behaviour* rather than card count. The deck wants neither.

### Bracket assessment

| List | Game Changers | Bracket |
|---|---|---|
| Current | Cyclonic Rift, Fierce Guardianship, Mystical Tutor, The One Ring | **4 — Optimized** |
| Option A | Cyclonic Rift, Fierce Guardianship, The One Ring | **3 — Upgraded** |
| Option B (rebuild) | Cyclonic Rift, Fierce Guardianship, The One Ring | **3 — Upgraded** |
| Option C | none | **2 — Core** |

Verified with `node apps/cli/dist/index.js bracket examples/nazgul.txt`. No mass land
denial, no extra turns and no two-card infinite combo in any version. Game Changers list as of
the 9 February 2026 brackets update (53 cards); tutors stopped being a bracket criterion in
October 2025, which is why nine Nazgûl and Ringsight cost the deck nothing.

---

## 8. Copy list for mtgprint.net

100 cards. Double-faced cards are given as the front face, which is what both mtgproxy and
mtgprint match on — if a site rejects one, use `Clearwater Pathway // Murkwater Pathway` and
`Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time`.

Twelve cards exist only in Middle-earth frames (Lord of the Nazgûl, Nazgûl, Witch-king Bringer
of Ruin, The One Ring, Call of the Ring, Birthday Escape, Claim the Precious, Gollum's Bite,
Ringsight, Sam's Desperate Rescue, Soothing of Sméagol, Minas Morgul Dark Fortress). For this
deck that is the point, but it is worth knowing there is no alternative frame for them.

```
1 An Offer You Can't Refuse
1 Arcane Denial
1 Arcane Signet
1 Archmage of Runes
1 Birthday Escape
1 Bitter Triumph
1 Bojuka Bog
1 Brainstorm
1 Cabal Ritual
1 Call of the Ring
1 Choked Estuary
1 Claim the Precious
1 Clearwater Pathway
1 Command Tower
1 Consider
1 Counterspell
1 Cover of Darkness
1 Cyclonic Rift
1 Dark Ritual
1 Darkslick Shores
1 Darkwater Catacombs
1 Deadly Rollick
1 Deep Analysis
1 Dimir Signet
1 Dispel
1 Drowned Catacomb
1 Fellwar Stone
1 Fetid Pools
1 Fierce Guardianship
1 Frantic Search
1 Go for the Throat
1 Gollum's Bite
1 Infernal Grasp
7 Island
1 Jace's Sanctum
1 Jet Medallion
1 Levitation
1 Lord of the Nazgûl
1 Minas Morgul, Dark Fortress
1 Morphic Pool
1 Mystic Sanctuary
9 Nazgûl
1 Negate
1 Night's Whisper
1 Ojer Pakpatiq, Deepest Epoch
1 Opt
1 Otawara, Soaring City
1 Ponder
1 Preordain
1 Reconnaissance Mission
1 Ringsight
1 River of Tears
1 Rona, Sheoldred's Faithful
1 Sam's Desperate Rescue
1 Sapphire Medallion
1 Saw in Half
1 Serum Visions
1 Shipwreck Marsh
1 Slip Out the Back
1 Snuff Out
1 Sol Ring
1 Soothing of Sméagol
1 Sunken Hollow
7 Swamp
1 Swan Song
1 Takenuma, Abandoned Mire
1 Talisman of Dominance
1 Talrand, Sky Summoner
1 Temple of Deceit
1 The One Ring
1 Tragic Slip
1 Trail of Evidence
1 Undercity Sewers
1 Underground River
1 Unearth
1 Victimize
1 Village Rites
1 Witch-king, Bringer of Ruin
1 Witch's Cottage
1 Wonder
```
