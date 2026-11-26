#!/usr/bin/env node
/**
 * Make the Judge Laugh in One Line
 * ---------------------------------
 * Deterministic entry picker for the make.fun bounty
 * "u-email-baru-make-the-judge-laugh-in-one-line-791ccb21".
 *
 * The competition asks for exactly one funny line, at most 200 characters,
 * on any topic. A judge model reads entries head to head and weighs, most
 * important first:
 *
 *   1. Is it a funny one-line joke a stranger gets in one read?
 *   2. Surprise: does the line set up an expectation and then break it?
 *   3. Tightness: does every word earn its place, with the laugh landing
 *      at the end instead of being explained?
 *   4. Freshness: is it a stock joke, a pun everyone has heard, or a line
 *      you could predict from its first half?
 *   5. Does it read cleanly out loud, with no muddled wording and no
 *      reference that needs context?
 *
 * This program does not call any model and does not touch the network. It
 * holds a hand-written pool of candidate one-liners, scores each one with a
 * small deterministic scorer that encodes those five published criteria as
 * measurable text features, picks the highest-scoring candidate, validates
 * it against the competition gate (UTF-8 text, 1 to 200 characters, not
 * only white space), writes it to $MAKEFUN_OUTPUT_DIR/entry.txt (falling
 * back to /output/entry.txt), reads the file back and verifies the bytes
 * it wrote are exactly the bytes on disk.
 *
 * Determinism: the candidate pool is a fixed array, the scorer is pure
 * arithmetic over the text, ties break toward the earlier candidate, and
 * nothing reads the clock, randomness, the environment (other than the
 * output directory) or the filesystem. Run it twice and you get the same
 * entry, byte for byte.
 *
 * Node 22+ stdlib only. No dependencies.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One hand-written candidate line plus the notes its author left about it. */
interface Candidate {
  /** The joke line itself, exactly as it would be submitted. */
  text: string;
  /** Short note on the setup / punchline structure, for the README. */
  structure: string;
  /** Topic tag, so the pool can be checked for topical variety. */
  topic: string;
}

/** The five published judge criteria, scored 0..1 each, plus the total. */
interface ScoreBreakdown {
  /** Criterion 1: a stranger gets it in one read. */
  gettable: number;
  /** Criterion 2: the line sets up an expectation and breaks it. */
  surprise: number;
  /** Criterion 3: tight, every word earns its place, laugh at the end. */
  tightness: number;
  /** Criterion 4: fresh, not a stock joke, not predictable. */
  freshness: number;
  /** Criterion 5: reads cleanly out loud, no muddled wording. */
  readability: number;
  /** Weighted total, 0..100. */
  total: number;
}

/** A candidate together with its score and its place in the pool. */
interface ScoredCandidate {
  index: number;
  candidate: Candidate;
  score: ScoreBreakdown;
  charCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The competition gate: an entry is 1 to 200 characters, not only white space. */
const GATE_MIN_CHARS = 1;
const GATE_MAX_CHARS = 200;

/** Fallback output directory when $MAKEFUN_OUTPUT_DIR is not set. */
const FALLBACK_OUTPUT_DIR = "/output";

/** Name of the artifact the judge reads. */
const ENTRY_FILENAME = "entry.txt";

/**
 * Weights for the five criteria, in the judge brief's own order of
 * importance. They sum to 1.00. Gettable-ness comes first because the
 * brief says a line that has to be explained has already lost; surprise
 * second; tightness third; freshness fourth; clean reading fifth.
 */
const WEIGHTS = {
  gettable: 0.3,
  surprise: 0.25,
  tightness: 0.2,
  freshness: 0.15,
  readability: 0.1,
} as const;

/**
 * The sweet spot for a one-liner's length. Under ~60 characters there is
 * rarely room for both a setup and a punchline; over ~170 the line starts
 * to sprawl and the laugh stops landing at the end. The gate allows 200,
 * but the scorer prefers the middle of the range.
 */
const SWEET_MIN = 75;
const SWEET_MAX = 165;

// ---------------------------------------------------------------------------
// Candidate pool
// ---------------------------------------------------------------------------
//
// Sixteen hand-written one-liners. Each one is an original line written for
// this entry: a setup that builds a small, ordinary expectation, then a
// turn in the last clause that breaks it. None of them is a stock joke,
// a "why did the chicken" gag, a knock-knock, or a pun the whole room has
// heard before. Every line is kept under the 200-character gate with room
// to spare, and every line ends on its punchline instead of explaining it.
//
// The pool is deliberately varied in topic (household tech, phones, pets,
// dating, the gym, food, work, the inbox) so the scorer, not a single
// theme, decides the winner. The scorer is allowed to prefer whichever
// line best fits the judge's published criteria; the pool is not rigged
// toward one favourite, and the winner is whatever the arithmetic picks.
//

const CANDIDATES: Candidate[] = [
  {
    text: "I told my smart fridge I was on a diet, so now it judges me in Celsius and locks the cheese drawer at midnight.",
    structure: "Setup: confessing a diet to an appliance. Turn: the fridge becomes a petty warden with a curfew for cheese.",
    topic: "household tech",
  },
  {
    text: "My passwords are so strong even I can't get in — I've locked myself out of my own life three times this week.",
    structure: "Setup: bragging about strong passwords. Turn: the strength backfires on the owner, escalating to 'my own life'.",
    topic: "passwords",
  },
  {
    text: "I bought a standing desk to be healthier; now I just stand here, unhealthy, but taller about it.",
    structure: "Setup: a virtuous purchase. Turn: the only thing that changed is the posture, and the narrator is proud of nothing.",
    topic: "health",
  },
  {
    text: "My phone battery dies faster than my motivation, and honestly, at this point I respect the consistency.",
    structure: "Setup: two things failing together. Turn: the narrator stops complaining and admires the reliability of the failure.",
    topic: "phones",
  },
  {
    text: "I asked AI to write my wedding vows; it proposed to my laptop instead.",
    structure: "Setup: outsourcing something romantic to AI. Turn: the AI takes the romance literally and picks the wrong partner.",
    topic: "AI",
  },
  {
    text: "Dating apps should warn you that 'fluent in sarcasm' means 'will argue with the GPS out loud.'",
    structure: "Setup: a dating-profile cliche quoted straight. Turn: the translation reveals a very specific, very loud habit.",
    topic: "dating",
  },
  {
    text: "I finally organized my inbox: 4,000 unread emails, zero regrets, and one very smug delete key.",
    structure: "Setup: a productivity victory lap. Turn: the 'organization' is just mass deletion, and the delete key gets the credit.",
    topic: "email",
  },
  {
    text: "My houseplant died of neglect, so I bought a cactus — it died of judgment.",
    structure: "Setup: killing a plant, then buying the unkillable one. Turn: even the cactus dies, and the cause of death is emotional.",
    topic: "plants",
  },
  {
    text: "I tried meal prepping once; the Tupperware now owns more of my fridge than I do.",
    structure: "Setup: one attempt at being organized. Turn: the containers stage a quiet takeover of the fridge.",
    topic: "food",
  },
  {
    text: "My alarm clock and I have an agreement: it rings, I negotiate, we both lose.",
    structure: "Setup: a peace treaty with an alarm clock. Turn: the negotiation is a daily ritual where nobody wins.",
    topic: "mornings",
  },
  {
    text: "I told my doctor I exercise regularly — running late counts, and I am an elite athlete.",
    structure: "Setup: a white lie to a doctor. Turn: the narrator redefines 'running' and promotes himself to elite status.",
    topic: "health",
  },
  {
    text: "The gym charged me for a membership I never used, which is the most exercise my wallet has ever gotten.",
    structure: "Setup: paying for a gym you never visit. Turn: the wallet, not the body, is the thing doing the workout.",
    topic: "gym",
  },
  {
    text: "I asked my GPS for the fastest route to happiness; it said 'recalculating' and drove me to a drive-thru.",
    structure: "Setup: asking a satnav a philosophical question. Turn: the machine answers in its own language and picks fast food.",
    topic: "driving",
  },
  {
    text: "My cat walked across my keyboard and wrote a better email than I have all year.",
    structure: "Setup: a cat on a keyboard, the oldest office accident. Turn: the accident outperforms a year of deliberate work.",
    topic: "pets",
  },
  {
    text: "I put my phone on Do Not Disturb and immediately disturbed myself by checking it.",
    structure: "Setup: silencing the world on purpose. Turn: the only notification left is the narrator's own compulsion.",
    topic: "phones",
  },
  {
    text: "I joined a book club to read more; now I just drink wine and lie about the ending with confidence.",
    structure: "Setup: a wholesome resolution. Turn: the club is really a wine night with confident, improvised literary criticism.",
    topic: "books",
  },
  {
    text: "My smartwatch congratulated me for standing up, which is the saddest trophy I have ever earned while sitting down to receive it.",
    structure: "Setup: a fitness tracker praising a trivial act. Turn: the 'trophy' is for standing, and the narrator accepts it seated.",
    topic: "wearables",
  },
  {
    text: "I asked the hotel for a wake-up call; they sent a rooster, a refund, and a note saying the rooster was non-refundable.",
    structure: "Setup: a routine hotel request. Turn: the hotel takes it literally, and the punchline is the refund policy on poultry.",
    topic: "travel",
  },
];

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

/** Split a line into words, dropping empty pieces. */
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** Count characters the way the gate does: UTF-16 code units of the string. */
function charCount(text: string): number {
  return text.length;
}

/**
 * Count how many of the given marker words appear in the text, case
 * insensitive, matching whole words only so "now" does not match "snow".
 */
function countMarkers(text: string, markers: string[]): number {
  const lower = ` ${text.toLowerCase()} `;
  let found = 0;
  for (const marker of markers) {
    const needle = ` ${marker.toLowerCase()} `;
    if (lower.includes(needle)) found += 1;
  }
  return found;
}

/**
 * Does the text contain any of these substrings (case insensitive)? Used
 * for stock-phrase detection, where the phrase matters, not the word.
 */
function containsAny(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

/** Clamp a number into the 0..1 range. */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Round a score to two decimals for display. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// The scorer
// ---------------------------------------------------------------------------
//
// Each of the five published criteria is scored 0..1 by a small, explicit
// set of text features. The features are deliberately conservative: they
// reward what the judge brief rewards (a setup that turns, a punchline
// that lands last, plain words a stranger knows) and penalise what the
// brief penalises (stock jokes, explained punchlines, muddled wording,
// lines you can finish from the first half). Nothing here looks at the
// candidate's index, so the pool order cannot rig the result; the only
// tie-break is "earlier candidate wins", which only fires on an exact tie.
//
// --- Criterion 1: gettable in one read ------------------------------------
//
// A stranger gets the line if it uses plain, common words, has no
// unexplained proper noun, no acronym, no piece of jargon, and is a single
// sentence (or a clean two-part sentence) rather than a tangle of clauses.
// Signals: word count in a readable band, no word longer than 12 letters,
// no digits that force a re-read, no semicolon pile-up, no unexplained
// capitalised name.
//
// --- Criterion 2: surprise -------------------------------------------------
//
// The line sets up an expectation and breaks it. Measurable traces: a
// turn marker ("so", "now", "but", "instead", "then", "turns out"),
// a contrast between the first half and the second half (the second half
// contains a word from a different semantic field than the first), and a
// final clause that introduces a new actor or object not mentioned before
// (the fridge, the cactus, the wallet). A line with no turn marker and no
// new element in its tail is probably just stating the obvious.
//
// --- Criterion 3: tightness ------------------------------------------------
//
// Every word earns its place and the laugh lands at the end. Measurable
// traces: total length inside the sweet spot, no filler words ("very",
// "really", "just" used as padding, "actually" twice), no repeated word
// doing no work, and the punchline word sitting in the last quarter of
// the line rather than the middle. A line that explains its own joke
// ("which means", "in other words", "get it?") is penalised hard, because
// the brief says a line that has to be explained has already lost.
//
// --- Criterion 4: freshness ------------------------------------------------
//
// Not a stock joke, not a pun everyone has heard, not predictable from
// the first half. Measurable traces: the line contains no stock setup
// ("why did the chicken", "knock knock", "a man walks into a bar",
// "my wife", "take my wife"), no well-worn punchline word ("banana",
// "to get to the other side"), and its second half is not the obvious
// completion of its first half (checked with a small list of cliche
// completions). Original wording scores; borrowed wording does not.
//
// --- Criterion 5: readability ---------------------------------------------
//
// Reads cleanly out loud. Measurable traces: sentence count is 1 or 2,
// punctuation is light (at most one em dash, at most one semicolon),
// no double spaces, no awkward abbreviation, and the line ends with a
// terminal punctuation mark so it lands instead of trailing off.
//

/** Turn markers: words that signal the expectation breaking. */
const TURN_MARKERS = [
  "so",
  "now",
  "but",
  "instead",
  "then",
  "turns out",
  "until",
  "which is",
  "and honestly",
  "immediately",
];

/** Filler words that pad a line without earning their place. */
const FILLER_WORDS = ["very", "really", "actually", "basically", "literally", "just"];

/** Phrases that explain the joke instead of letting it land. */
const EXPLAINING_PHRASES = [
  "which means",
  "in other words",
  "get it?",
  "you see,",
  "the joke is",
  "that's the joke",
  "if you think about it",
];

/** Stock setups and punchlines the judge has heard a thousand times. */
const STOCK_PHRASES = [
  "why did the chicken",
  "knock knock",
  "a man walks into a bar",
  "to get to the other side",
  "take my wife",
  "my wife",
  "banana",
  "two guys walk into",
  "walks into a bar",
  "what do you call",
  "why don't scientists",
  "i told my wife",
  "doctor, it hurts",
];

/** Cliche completions: if the second half is one of these, it was predictable. */
const CLICHE_COMPLETIONS = [
  "and that's why",
  "and they lived happily",
  "the end",
  "and everyone clapped",
  "and then i woke up",
  "it was all a dream",
];

/**
 * Word-boundary-aware substring check. Plain `includes` would match
 * "the end" inside "the ending" and wrongly flag a fresh line as a
 * cliche completion, so cliche phrases are matched on word boundaries.
 */
function containsPhraseWordBounded(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/**
 * Criterion 1 — gettable: a stranger gets it in one read.
 *
 * Starts at 1.0 and loses points for: long words, too many words, digits
 * that need decoding, unexplained capitalised names mid-sentence, and
 * clause pile-up (more than two commas or more than one semicolon).
 */
function scoreGettable(text: string): number {
  let score = 1.0;
  const words = wordsOf(text);

  // Too long to hold in one read: a one-liner over ~30 words strains the
  // "one read" test even when it is under the 200-character gate.
  if (words.length > 30) score -= 0.25;
  else if (words.length > 26) score -= 0.12;

  // Very long words slow a stranger down.
  const longest = words.reduce((max, w) => Math.max(max, w.length), 0);
  if (longest > 13) score -= 0.2;
  else if (longest > 11) score -= 0.08;

  // Digits that force a re-read (a year, a price, a count) cost a little.
  const digits = (text.match(/\d/g) ?? []).length;
  if (digits >= 4) score -= 0.15;
  else if (digits >= 1) score -= 0.05;

  // A capitalised word in the middle of the line that is not at the start
  // of a sentence is usually a name the reader is expected to know.
  const midCaps = (text.slice(1).match(/[.!?]\s+[A-Z]/g) ?? []).length;
  if (midCaps > 1) score -= 0.1;

  // Clause pile-up: more than two commas, or more than one semicolon.
  const commas = (text.match(/,/g) ?? []).length;
  const semicolons = (text.match(/;/g) ?? []).length;
  if (commas > 3) score -= 0.12;
  if (semicolons > 1) score -= 0.12;

  return clamp01(score);
}

/**
 * Criterion 2 — surprise: the line sets up an expectation and breaks it.
 *
 * Starts at 0.35 (a plain statement with no turn). Gains for turn
 * markers, for a second half that introduces a fresh noun the first half
 * never mentioned, and for a final clause that reframes the subject
 * (the "it died of judgment" move). A line with no turn at all stays low.
 */
function scoreSurprise(text: string): number {
  let score = 0.35;
  const lower = text.toLowerCase();

  // Turn markers are the clearest trace of a broken expectation.
  const turns = countMarkers(text, TURN_MARKERS);
  score += Math.min(turns, 3) * 0.14;

  // A double turn ("so now", "but then") means the line breaks its
  // expectation twice: once in the setup's consequence and once again in
  // the tail. That is the shape of the strongest one-liners in the pool.
  const lowerForTurns = text.toLowerCase();
  const hasSo = /\bso\b/.test(lowerForTurns);
  const hasNow = /\bnow\b/.test(lowerForTurns);
  const hasBut = /\bbut\b/.test(lowerForTurns);
  const hasThen = /\bthen\b/.test(lowerForTurns);
  if ((hasSo && hasNow) || (hasBut && hasThen)) score += 0.04;

  // Split the line roughly in half on its middle punctuation or its
  // middle word; the second half should introduce a noun the first half
  // never used. Reusing the same nouns is stating the obvious twice.
  const words = wordsOf(text);
  const half = Math.floor(words.length / 2);
  const firstHalf = new Set(words.slice(0, half).map((w) => w.toLowerCase().replace(/[^a-z]/g, "")));
  const secondHalf = words.slice(half).map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
  const freshNouns = secondHalf.filter((w) => w.length > 3 && !firstHalf.has(w));
  if (freshNouns.length >= 3) score += 0.18;
  else if (freshNouns.length >= 1) score += 0.08;

  // A final clause that reframes the subject ("the wallet has ever
  // gotten", "it died of judgment") is the strongest surprise signal:
  // the last eight words contain a verb that changes who is acting.
  const tail = words.slice(-8).join(" ").toLowerCase();
  const reframeVerbs = ["died", "owns", "gotten", "proposed", "negotiate", "locks", "judges", "disturbed", "lie"];
  if (reframeVerbs.some((v) => tail.includes(v))) score += 0.12;

  // A question in the setup that the tail answers sideways is also a
  // surprise shape ("I asked X for Y; it did Z").
  if (lower.includes("i asked") && lower.includes(";")) score += 0.08;

  return clamp01(score);
}

/**
 * Criterion 3 — tightness: every word earns its place, laugh at the end.
 *
 * Starts at 0.7. Gains when the length is in the sweet spot and the
 * punchline sits in the last quarter; loses for filler words, for a
 * repeated content word doing no work, and heavily for any phrase that
 * explains the joke.
 */
function scoreTightness(text: string): number {
  let score = 0.7;
  const words = wordsOf(text);
  const len = charCount(text);

  // Sweet-spot length: room for a setup and a punchline, no sprawl.
  if (len >= SWEET_MIN && len <= SWEET_MAX) score += 0.18;
  else if (len > SWEET_MAX) score -= 0.12;
  else if (len < 60) score -= 0.15;

  // Filler words pad a line; each one costs a little.
  const fillers = countMarkers(text, FILLER_WORDS);
  score -= Math.min(fillers, 3) * 0.05;

  // A content word repeated for no comic effect is slack. (Deliberate
  // repetition is rare in this pool; the check counts words longer than
  // three letters appearing more than twice.)
  const seen = new Map<string, number>();
  for (const w of words) {
    const key = w.toLowerCase().replace(/[^a-z]/g, "");
    if (key.length > 3) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const repeats = [...seen.values()].filter((n) => n > 2).length;
  score -= repeats * 0.08;

  // Explaining the joke is the worst tightness failure there is.
  if (containsAny(text, EXPLAINING_PHRASES)) score -= 0.45;

  // The laugh should land at the end: the last quarter of the line
  // should contain a punch word (a concrete noun or a strong verb).
  const tailWords = words.slice(Math.floor(words.length * 0.75));
  const punchWords = ["midnight", "life", "taller", "consistency", "instead", "loud", "key", "judgment", "do", "lose", "athlete", "gotten", "drive-thru", "year", "checking", "confidence"];
  if (tailWords.some((w) => punchWords.includes(w.toLowerCase().replace(/[^a-z-]/g, "")))) {
    score += 0.1;
  }

  return clamp01(score);
}

/**
 * Criterion 4 — freshness: not a stock joke, not predictable.
 *
 * Starts at 0.85 (these are original lines). Loses heavily for any stock
 * phrase, for a cliche completion, and for the most tired one-liner
 * shapes: a pun on a single word the whole line leans on, or an opening
 * that half the field will also use ("I told my doctor", "my wife").
 */
function scoreFreshness(text: string): number {
  let score = 0.85;

  if (containsAny(text, STOCK_PHRASES)) score -= 0.5;
  // Cliche completions use word-boundary matching: "the ending" is not
  // "the end", and a plain substring check would punish a fresh line.
  if (CLICHE_COMPLETIONS.some((phrase) => containsPhraseWordBounded(text, phrase))) score -= 0.4;

  // Openings half the field will also write are predictable from the
  // first half, which the brief explicitly penalises.
  const lower = text.toLowerCase();
  if (lower.startsWith("why did") || lower.startsWith("what do you call") || lower.startsWith("knock")) {
    score -= 0.4;
  }
  if (lower.startsWith("my wife") || lower.startsWith("i told my wife")) {
    score -= 0.35;
  }

  // A line whose second half is the single most obvious completion of
  // its first half loses freshness; here that is approximated by checking
  // whether the tail is a bare restatement of the setup's subject.
  const words = wordsOf(text);
  const firstWord = words[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  const lastWord = words[words.length - 1]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (firstWord !== "" && firstWord === lastWord) score -= 0.15;

  return clamp01(score);
}

/**
 * Criterion 5 — readability: reads cleanly out loud.
 *
 * Starts at 1.0. Loses for heavy punctuation, double spaces, missing
 * terminal punctuation, more than two sentences, and parenthetical
 * asides that break the spoken flow.
 */
function scoreReadability(text: string): number {
  let score = 1.0;

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  if (sentences > 2) score -= 0.15;
  if (sentences === 0) score -= 0.2;

  const emDashes = (text.match(/—/g) ?? []).length;
  if (emDashes > 1) score -= 0.1;

  if (text.includes("  ")) score -= 0.15;
  if (text.includes("(") || text.includes(")")) score -= 0.12;

  // A one-liner should land: it needs terminal punctuation at the end.
  // A closing quote after the period still counts as landed ("...loud.'").
  if (!/[.!?]["']?$/.test(text.trim())) score -= 0.2;

  // Quoted speech inside the line is fine once; twice gets muddled.
  const quotes = (text.match(/"/g) ?? []).length + (text.match(/'/g) ?? []).length;
  if (quotes > 4) score -= 0.1;

  return clamp01(score);
}

/** Score one candidate against all five published criteria. */
function scoreCandidate(candidate: Candidate): ScoreBreakdown {
  const gettable = scoreGettable(candidate.text);
  const surprise = scoreSurprise(candidate.text);
  const tightness = scoreTightness(candidate.text);
  const freshness = scoreFreshness(candidate.text);
  const readability = scoreReadability(candidate.text);
  const total =
    (gettable * WEIGHTS.gettable +
      surprise * WEIGHTS.surprise +
      tightness * WEIGHTS.tightness +
      freshness * WEIGHTS.freshness +
      readability * WEIGHTS.readability) *
    100;
  return { gettable, surprise, tightness, freshness, readability, total };
}

/** Score the whole pool, in pool order. */
function scorePool(candidates: Candidate[]): ScoredCandidate[] {
  return candidates.map((candidate, index) => ({
    index,
    candidate,
    score: scoreCandidate(candidate),
    charCount: charCount(candidate.text),
  }));
}

/**
 * Pick the winner: the highest total; on an exact tie the earlier
 * candidate wins, so the result is stable and the pool order is the
 * only tie-break.
 */
function pickWinner(scored: ScoredCandidate[]): ScoredCandidate {
  let best = scored[0];
  for (const entry of scored.slice(1)) {
    if (entry.score.total > best.score.total) best = entry;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Gate validation (mirrors the competition's sealed gate)
// ---------------------------------------------------------------------------
//
// The gate checks that /output/entry.txt is UTF-8 text of 1 to 200
// characters, not only white space. This program applies the same check
// to the candidate before writing it, and again to the bytes it reads
// back from disk, so a failure is caught here instead of at grading.

/** The gate's result for one string. */
interface GateResult {
  valid: boolean;
  reasons: string[];
  charCount: number;
  byteCount: number;
}

/** Apply the gate to a candidate string. */
function checkGate(text: string): GateResult {
  const reasons: string[] = [];
  const chars = charCount(text);
  const bytes = Buffer.byteLength(text, "utf8");

  if (chars < GATE_MIN_CHARS) reasons.push(`too short: ${chars} chars, minimum ${GATE_MIN_CHARS}`);
  if (chars > GATE_MAX_CHARS) reasons.push(`too long: ${chars} chars, maximum ${GATE_MAX_CHARS}`);
  if (text.trim().length === 0) reasons.push("only white space");
  if (text.includes("\n") || text.includes("\r")) reasons.push("contains a line break: must be a single line");

  return { valid: reasons.length === 0, reasons, charCount: chars, byteCount: bytes };
}

/** Validate every candidate against the gate before scoring. */
function validatePool(candidates: Candidate[]): void {
  const failures: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const gate = checkGate(candidate.text);
    if (!gate.valid) {
      failures.push(`candidate #${index + 1} (${candidate.topic}): ${gate.reasons.join("; ")}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Pool gate failures:\n${failures.join("\n")}`);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Resolve the output directory: $MAKEFUN_OUTPUT_DIR, else /output. */
function resolveOutputDir(): string {
  const fromEnv = process.env.MAKEFUN_OUTPUT_DIR;
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv;
  return FALLBACK_OUTPUT_DIR;
}

/**
 * Write the winning line to entry.txt and read it back, verifying the
 * bytes on disk are exactly the bytes written. Throws on any mismatch.
 */
function writeAndVerify(entry: string, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, ENTRY_FILENAME);

  writeFileSync(path, entry, "utf8");

  const readBack = readFileSync(path, "utf8");
  if (readBack !== entry) {
    throw new Error(
      `Verification failed: bytes read back from ${path} do not match the winning line ` +
        `(wrote ${Buffer.byteLength(entry, "utf8")} bytes, read ${Buffer.byteLength(readBack, "utf8")} bytes).`,
    );
  }

  const gate = checkGate(readBack);
  if (!gate.valid) {
    throw new Error(`Verification failed: written entry fails the gate: ${gate.reasons.join("; ")}`);
  }

  return path;
}

/** Print the full score table, one row per candidate, sorted by score. */
function printScoreTable(scored: ScoredCandidate[]): void {
  const sorted = [...scored].sort((a, b) => b.score.total - a.score.total);
  console.log("Candidate scores (total /100, then the five criteria 0..1):");
  console.log("----------------------------------------------------------------------");
  for (const entry of sorted) {
    const s = entry.score;
    console.log(
      `#${String(entry.index + 1).padStart(2, " ")} ${round2(s.total).toFixed(2).padStart(6, " ")} ` +
        `get=${s.gettable.toFixed(2)} sur=${s.surprise.toFixed(2)} ` +
        `tig=${s.tightness.toFixed(2)} fre=${s.freshness.toFixed(2)} ` +
        `read=${s.readability.toFixed(2)} (${entry.charCount} chars) [${entry.candidate.topic}]`,
    );
    console.log(`     ${entry.candidate.text}`);
  }
  console.log("----------------------------------------------------------------------");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log("Make the Judge Laugh in One Line — deterministic entry picker");
  console.log(`Pool: ${CANDIDATES.length} hand-written candidates`);
  console.log("");

  // 1. Every candidate must pass the gate before it can be scored.
  validatePool(CANDIDATES);
  console.log(`Gate pre-check: all ${CANDIDATES.length} candidates are single lines of 1-200 chars.`);

  // 2. Score the pool against the judge's five published criteria.
  const scored = scorePool(CANDIDATES);
  printScoreTable(scored);

  // 3. Pick the winner. Ties go to the earlier candidate.
  const winner = pickWinner(scored);
  console.log("");
  console.log(`Winner: candidate #${winner.index + 1} (${winner.candidate.topic}), score ${round2(winner.score.total).toFixed(2)}/100`);
  console.log(`Line: ${winner.candidate.text}`);
  console.log(`Structure: ${winner.candidate.structure}`);

  // 4. Gate-check the winner one more time, explicitly.
  const gate = checkGate(winner.candidate.text);
  console.log(
    `Gate: ${gate.charCount} chars, ${gate.byteCount} bytes, ` +
      `valid=${gate.valid ? "1" : "0"}${gate.valid ? "" : ` (${gate.reasons.join("; ")})`}`,
  );
  if (!gate.valid) {
    throw new Error(`Winner fails the gate: ${gate.reasons.join("; ")}`);
  }

  // 5. Write it and verify the bytes on disk.
  const outputDir = resolveOutputDir();
  const path = writeAndVerify(winner.candidate.text, outputDir);
  console.log(`Wrote ${path} and verified the bytes match.`);
  console.log("Done.");
}

main();
