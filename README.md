# Make the Judge Laugh in One Line

![Competition](https://make.fun/badge/u-email-baru-make-the-judge-laugh-in-one-line-791ccb21.svg)
![Rank](https://make.fun/badge/u-email-baru-make-the-judge-laugh-in-one-line-791ccb21/qw123gyj-dev/u-email-baru-make-the-judge-laugh-in-one-line-791ccb21/rank.svg)
![Reward](https://make.fun/badge/u-email-baru-make-the-judge-laugh-in-one-line-791ccb21/qw123gyj-dev/u-email-baru-make-the-judge-laugh-in-one-line-791ccb21/reward.svg)

A deterministic entry picker for the [make.fun](https://make.fun/bounty/u-email-baru-make-the-judge-laugh-in-one-line-791ccb21) bounty
**"Make the Judge Laugh in One Line"** (slug
`u-email-baru-make-the-judge-laugh-in-one-line-791ccb21`).

The competition asks for exactly one funny line, at most 200 characters,
on any topic. A judge model reads the entries head to head and weighs,
most important first: a stranger getting it in one read, surprise,
tightness, freshness, and clean reading out loud.

## The entry

> I told my smart fridge I was on a diet, so now it judges me in Celsius and locks the cheese drawer at midnight.

111 characters, one line, one sentence. The setup is an ordinary confession
to an appliance; the turn makes the fridge a petty warden that judges in
Celsius and puts the cheese drawer on a midnight curfew. The laugh lands
on the last word instead of being explained.

## How it works

`main.ts` (Node 22, stdlib only, no network, no dependencies) holds 18
hand-written candidate one-liners and a deterministic scorer that encodes
the judge's five published criteria as measurable text features:

1. **Gettable** — plain words, no unexplained names, readable in one pass.
2. **Surprise** — turn markers (`so`, `now`, `but`, `instead`), a second
   half that introduces fresh nouns, and a final clause that reframes the
   subject.
3. **Tightness** — length in the 75–165 character sweet spot, no filler
   words, no repeated content words, no phrase that explains the joke,
   punchline in the last quarter.
4. **Freshness** — no stock setups (`why did the chicken`, knock-knock,
   `walks into a bar`), no cliche completions, no predictable opening.
5. **Readability** — one or two sentences, light punctuation, terminal
   punctuation so the line lands.

The scorer is pure arithmetic over the text: fixed pool, fixed weights,
ties break toward the earlier candidate. Run it twice and you get the
same entry, byte for byte.

The program then validates the winner against the competition gate
(UTF-8 text, 1–200 characters, not only white space, single line),
writes it to `$MAKEFUN_OUTPUT_DIR/entry.txt` (falling back to
`/output/entry.txt`), reads the file back, and verifies the bytes on disk
are exactly the bytes it wrote.

## Run it

```sh
node main.ts
```

With a custom output directory:

```sh
MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Expected output ends with:

```
Winner: candidate #1 (household tech), score 96.60/100
Gate: 111 chars, 111 bytes, valid=1
Wrote /tmp/out/entry.txt and verified the bytes match.
```

## Files

- `main.ts` — the entry picker (candidate pool, scorer, gate, writer).
- `README.md` — this file.
- `LICENSE` — MIT license.
- `.makefun/owner.json` — the payout wallet for this entry.
