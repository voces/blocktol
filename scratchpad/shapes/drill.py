"""Drill into one approach: subdivide a group that is too big to scan.

The panel's top level answers "what did I try?". Once a group holds 150 runs
that question is answered and the next one is "which version of it?" -- so the
drill-down is the same pipeline applied to one group's members, which the
hierarchy supports for free: the dendrogram is already built, cutting it lower
is the whole operation.

Two things differ from the top level:

  - names inherit the parent's head phrase, so a subgroup says only what makes
    it that version of the approach ("scattered blocks", "works the west side")
    rather than repeating "clockwise spiral" on every row
  - subgroups are ordered by best time like everything else, but the useful
    reading is often the SPREAD: a group's members range from 8s to 33s, so a
    subgroup is as much a quality band as a shape
"""

import sys
from collections import Counter

import numpy as np

import shapes as S
import cluster as C
import attempts as A
import report as R

# A drilled view wants to stay scannable too, and it is one level deeper, so
# it can afford fewer rows than the top-level panel.
SUB_TARGET = 6


def drill(rows, idx, target=SUB_TARGET, parent_phrases=()):
    """Subdivide one group's mazes. Returns (subgroups, traits)."""
    members = [rows[i] for i in idx]
    tr, Ds = S.views(members)
    D = S.combine(Ds)
    sigs = np.array([C.signature(t) for t in tr])
    D = D + A.SIG_PENALTY * (sigs[:, None] != sigs[None, :])
    np.fill_diagonal(D, 0.0)

    merges = S.agglomerate(D)
    # Same adaptive rule as the top level: cut at the natural "same approach"
    # height, then cap. A group that really is one thing stays one row rather
    # than being split to fill a quota.
    natural = S.cut(merges, len(members), height=A.SAME_APPROACH)
    k = min(target, len(set(natural.tolist())))
    labels = S.cut(merges, len(members), k=k)

    subs = []
    for c in sorted(set(labels.tolist())):
        sel = [j for j in range(len(members)) if labels[j] == c]
        clean = [j for j in sel if not members[j]["leaked"]] or sel
        bj = max(clean, key=lambda j: members[j]["time"])
        subs.append({
            "sig": sigs[bj], "idx": sel, "best": bj,
            "best_time": members[bj]["time"],
            "runs": sum(members[j]["attempts"] for j in sel),
            "mazes": len(sel),
            "worst": min(members[j]["time"] for j in sel),
        })
    subs.sort(key=lambda g: -g["best_time"])
    name_subgroups(subs, tr, parent_phrases,
                   times=[m["time"] for m in members])
    return subs, tr


# Extra vocabulary that only earns its place one level down. Route LENGTH is the
# single most legible difference between two versions of one shape -- 154 units
# against 97 is "the long way round" against "the short version" -- but at top
# level it says little, because length there is mostly just a proxy for time,
# which the panel already shows.
SUB_NAMEABLE = C.NAMEABLE + [
    ("length", "the long way round", "the short version"),
    # Triggering a thunder halves the runner's speed, so milking one is a
    # deliberate tactic and skirting it is a different route entirely -- a real
    # strategic split that nothing else in the vocabulary expresses. Dead on the
    # 62 of 78 boards with no power budget, where it is constant and the
    # no-variation guard drops it.
    ("n_slows", "milks the thunder", "skirts the thunder"),
]

# Above this |correlation with time| inside a parent, a trait is not describing
# the maze, it is restating the score already printed next to it.
#
# Measured within-parent across both iterations: length runs a median |r| of
# 0.82 (max 1.00), n_turns 0.61, total_turning 0.57, while the positional traits
# sit at 0.21-0.29. So "the long way round" topped five of five of one player's
# groups -- true every time, and worth nothing, because on a fixed-speed runner
# a longer route IS a longer time.
#
# Applied per parent rather than globally, because the relationship is not a
# law: a thunder breaks it. A route that milks a slow buys time without buying
# length, so on a board with power the correlation drops and length becomes
# informative again -- exactly where it should be allowed back in.
CORR_MAX = 0.70

_COMPASS = ["east", "north-east", "north", "north-west",
            "west", "south-west", "south", "south-east"]


def _entry_phrase(t):
    """Which side the runner arrives at the checkpoint from."""
    # `approach` is the bearing of TRAVEL, so the runner came from the opposite
    # side: heading north means it entered from the south.
    came = (float(t["approach"]) + 180.0) % 360.0
    return "enters from the " + _COMPASS[int((came + 22.5) % 360 // 45)]


def _wall_phrase(t):
    """Which third of the board the player's biggest wall sits in."""
    third = lambda v: 0 if v < N_THIRD else (2 if v > 2 * N_THIRD else 1)
    cx, cy = third(float(t["wall_cx"])), third(float(t["wall_cy"]))
    ns = ("north", "", "south")[cy]
    ew = ("west", "", "east")[cx]
    where = "-".join(p for p in (ns, ew) if p) or "centre"
    return f"wall in the {where}" if where != "centre" else "wall across the centre"


N_THIRD = S.N / 3.0

# Categorical traits: the value IS the phrase, so nothing is banded.
#
# This is the fix for what banding could not do. A band asks "is this value
# extreme?", which within one shape is almost always no -- the shape is exactly
# what holds those values together, so the quartiles collapse onto a single
# number and the phrases stop meaning anything. A label asks "which one is it?",
# which stays answerable however tight the group is: two versions can be
# "enters from the south" and "enters from the north-east" with no notion of
# extremeness involved at all.
CATEGORICAL = [
    ("approach", _entry_phrase),
    ("wall", _wall_phrase),
]

# What a trait says when it is in neither tail.
#
# A band has three regions and only two were ever spoken, so a version sitting
# between its peers had nothing true left to say and simply stopped short: of
# three subgroups sharing a prefix, two ended "works the east side" and "works
# the west side" while the third just ended, defined purely by the absence of a
# third phrase. Being in the middle IS a fact about a maze, and when the peers
# are split across a trait's two ends it is exactly the fact that separates it.
#
# Ranked below both tails, so these surface only where a name would otherwise
# have run out -- being middling is the least interesting thing that can be said
# about a maze, and it should be said only when it is the distinguishing thing.
MIDDLE = {
    "west": "even east-to-west",
    "north": "even north-to-south",
    "hug": "midway off the walls",
    "spiral_depth": "an even weave",
    "n_turns": "a middling number of turns",
    "total_turning": "middling winding",
    "max_wall": "middling wall lengths",
    "length": "middling length",
    "n_slows": "some thunder contact",
}


def name_subgroups(subs, tr, parent_phrases=(), times=None):
    """Name subgroups RELATIVE to their parent, not against global bands.

    Top-level names must be absolute: they have to mean the same thing across
    players and stay put as a session grows. A drill-down is the opposite
    situation. It is transient context -- the player is looking at one group and
    comparing its versions to each other -- and its parent is already named
    stably, so the only question left is how these versions differ AMONG
    THEMSELVES.

    Global bands answer the wrong question here, and visibly so: two subgroups
    whose routes ran 154 and 97 units both came out "scattered blocks" because
    both sat on the same side of every absolute cutoff, and the panel had to
    number them apart. Banding at the parent's own quartiles instead splits
    exactly where the variation actually is.
    """
    skip = set(parent_phrases)
    t = None if times is None else np.asarray(times, dtype=float)
    vals = {}
    for key, _hi, _lo in SUB_NAMEABLE:
        col = np.array([float(tr[j][key]) for j in range(len(tr))])
        # A trait that never varies here cannot tell these versions apart --
        # n_slows on a board with no thunder, most obviously.
        if col.std() < 1e-9:
            continue
        if t is not None and t.std() > 1e-9:
            if abs(np.corrcoef(col, t)[0, 1]) >= CORR_MAX:
                continue
        lo_cut, hi_cut = np.percentile(col, 25), np.percentile(col, 75)
        # Quartiles of a near-constant trait are meaningless: inside one group
        # spiral_depth ran p25=5.0, median=5.0, p75=5.2, so the cutoff sat ON
        # the commonest value and every maze at 5 "qualified" as the low end
        # with zero margin. Two subgroups with the SAME depth of 5 then had one
        # labelled "loose weave" and the other not -- decided purely by which
        # other phrase outranked it. A trait needs real spread before its
        # quartiles mean anything.
        if hi_cut - lo_cut < 0.1 * (abs(np.mean(col)) + 1e-9):
            continue
        vals[key] = (lo_cut, hi_cut)

    specs = []
    for sg in subs:
        r = sg["best"]
        spoken, middles = [], []
        for key, hi, lo in SUB_NAMEABLE:
            if key == "pocket" or key not in vals:
                continue
            lo_cut, hi_cut = vals[key]
            v = float(tr[r][key])
            phrase = hi if v > hi_cut else lo if v < lo_cut else None
            if phrase and phrase not in skip:
                spoken.append((abs(v - (hi_cut if v >= hi_cut else lo_cut)),
                               key, phrase))
            elif phrase is None and key in MIDDLE and MIDDLE[key] not in skip:
                middles.append((key, MIDDLE[key]))
        spoken.sort(reverse=True)
        # Categorical labels lead, ranked by how FEW versions share them: a
        # label two of six carry separates more than one five of six carry.
        # They go first because a band can only ever say "unusually X" while a
        # label says which X, and within one shape that is the live question.
        cats = []
        for key, fn in CATEGORICAL:
            lab = fn(tr[r])
            if lab in skip:
                continue
            share = sum(1 for s2 in subs if fn(tr[s2["best"]]) == lab)
            if share < len(subs):  # a label everyone shares separates nobody
                cats.append((share, key, lab))
        cats.sort()
        # Tails first, then categoricals' leftovers, then the middles last.
        specs.append([p for _s, _k, p in cats]
                     + [p for _m, _k, p in spoken]
                     + [p for _k, p in middles])

    counts = [min(1, len(sp)) for sp in specs]
    for _ in range(len(SUB_NAMEABLE) + 1):
        seen = Counter(frozenset(specs[i][:counts[i]]) for i in range(len(specs)))
        dup = {k for k, n in seen.items() if n > 1}
        if not dup:
            break
        grew = False
        for i in range(len(specs)):
            if frozenset(specs[i][:counts[i]]) in dup and counts[i] < len(specs[i]):
                counts[i] += 1
                grew = True
        if not grew:
            break

    # Expansion is greedy and does not know in advance whether it will succeed.
    # Where it failed -- two versions the vocabulary genuinely cannot tell apart
    # -- every phrase it bought along the way was wasted, and the result was a
    # four-phrase name that STILL needed a number after it. Give those back.
    #
    # Rolled back only as far as stays clear of the names that did separate,
    # since shortening a tied pair can otherwise collide it with a third group
    # that was fine, spreading the numbering to an innocent row.
    tied = {k for k, n in Counter(frozenset(specs[i][:counts[i]])
                                  for i in range(len(specs))).items() if n > 1}
    if tied:
        settled = [frozenset(specs[i][:counts[i]]) for i in range(len(specs))
                   if frozenset(specs[i][:counts[i]]) not in tied]
        for i in range(len(specs)):
            if frozenset(specs[i][:counts[i]]) not in tied:
                continue
            for c in range(min(1, len(specs[i])), counts[i] + 1):
                if frozenset(specs[i][:c]) not in settled:
                    counts[i] = c
                    break

    # Keep a phrase only where it SPLITS the rows that share everything kept
    # before it. This generalises the earlier "drop what everyone carries":
    # dropping only panel-wide commons left three rows reading "enters from the
    # south-east, wall in the west, ..." where every row that said the first
    # phrase also said the second, so the second separated nobody -- it just was
    # not common to the whole panel, only to the cohort the first phrase had
    # already picked out.
    #
    # Walking rank order and narrowing a cohort keeps the useful case the flat
    # rule also got right: a phrase two of three rows share DOES split them from
    # the third, so it stays. It also preserves the shared prefix, so rows that
    # belong to one family still read as one family rather than being minimised
    # into unrelated fragments.
    sets = [set(specs[i][:counts[i]]) for i in range(len(specs))]
    names = []
    for i in range(len(specs)):
        cohort = set(range(len(specs)))
        kept = []
        for p in specs[i][:counts[i]]:
            if len(cohort) == 1:
                break
            splits = {j for j in cohort if p in sets[j]}
            if len(splits) == len(cohort):
                continue  # everyone still in play says this; it separates none
            kept.append(p)
            cohort = splits
        names.append(", ".join(kept) or "the plain version")
    dup = {n for n, c in Counter(names).items() if c > 1}
    seen = Counter()
    for i, n in enumerate(names):
        if n in dup:
            seen[n] += 1
            names[i] = f"{n} ({seen[n]})"
    for sg, nm in zip(subs, names):
        sg["name"] = nm


if __name__ == "__main__":
    by = S.load()
    NAMES = R.load_names()
    it = int(sys.argv[1]) if len(sys.argv) > 1 else 125
    want = sys.argv[2] if len(sys.argv) > 2 else None

    for u in sorted({r["user"] for r in by[it]},
                    key=lambda u: -max(r["time"] for r in by[it] if r["user"] == u)):
        who = NAMES.get(u, u[:8])
        if want and want.lower() not in who.lower():
            continue
        runs = [r for r in by[it] if r["user"] == u]
        rows, groups, floored, floor = R.session_groups(
            runs, A.load_leaks(u[:8], it), runs[0]["min"])
        print(f"\n{'='*88}\n{who} — iteration {it}\n{'='*88}")
        for g in groups:
            print(f"\n  {g['name']}   best {g['best_time']:.2f}s, {g['runs']} runs")
            if g["mazes"] < 8:
                print("      (small enough to list directly)")
                continue
            parent = [p.strip() for p in g["name"].split(",")[1:]]
            subs, _tr = drill(rows, g["idx"], parent_phrases=parent)
            print(f"      {'best':>7} {'worst':>7} {'runs':>5}  version")
            print(f"      {'-'*7} {'-'*7} {'-'*5}  {'-'*50}")
            for sg in subs:
                print(f"      {sg['best_time']:>7.2f} {sg['worst']:>7.2f} "
                      f"{sg['runs']:>5}  {sg['name']}")
