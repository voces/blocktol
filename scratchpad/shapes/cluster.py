"""Group one iteration's runs into named shapes, and validate the grouping.

Architecture: topology partitions, geometry refines.

  1. A hard pre-partition on a discrete topological signature (does the route
     pocket the checkpoint, and which way does it wind). These are qualitative
     differences -- no amount of geometric closeness should ever merge a
     clockwise route with a counter-clockwise one, which is precisely the
     distinction the eye makes first.
  2. Inside each partition, average-linkage agglomerative clustering on the
     combined multi-view distance, cut at the silhouette-optimal height.
  3. Names composed from whichever interpretable traits most distinguish each
     cluster from the rest of the field -- so a name is a function of the
     cluster's own geometry and stays stable as runs arrive.
"""

import math
import sys
from collections import Counter, defaultdict

import numpy as np

import shapes as S


# ---------------------------------------------------------------------------
# 1. the hard topological signature
# ---------------------------------------------------------------------------

def signature(t):
    """Coarse, discrete, human-checkable class of a route.

    Only genuinely DISCRETE properties may live here, because a hard partition
    on a thresholded continuous quantity is a knife edge: two routes either
        side of the cutoff get split no matter how identical they are. An
    earlier version added a "deep vs shallow" bit at |wraps| >= 0.9 and duly
    split two routes whose turn words differed by a single leading turn. Wrap
    MAGNITUDE is continuous, so it belongs to the turning-function view, which
    grades it. What is left is genuinely qualitative:

      - does the route reverse out of a pocket at the checkpoint, or flow
        through it -- a topological fact, present or absent
      - which way does it wind -- a sign

    A near-zero net winding has an unstable sign, so it gets its own "flat"
    band rather than being forced to one side.

    A finer signature (the full h-signature word over the board's fixed
    obstacles, as in Bhattacharya et al.) is exactly the homotopy class, but it
    fragments a session into near-singletons; these two bits carry the
    distinctions a player would actually name out loud.
    """
    pocket = "pocket" if t["flips"] > 0 else "through"
    w = t["net_wraps_out"]
    hand = "cw" if w > 0.15 else "ccw" if w < -0.15 else "flat"
    return f"{pocket}/{hand}"


# ---------------------------------------------------------------------------
# 2. clustering with automatic granularity
# ---------------------------------------------------------------------------

def best_cut(D, merges, n, kmax=8):
    """Pick the flat clustering with the best mean silhouette width.

    Silhouette on the precomputed distance is the right criterion here because
    the distance is not Euclidean, so variance-based scores (elbow, gap
    statistic against a uniform null) do not apply cleanly.
    """
    best, best_s, best_k = None, -2.0, 1
    for k in range(2, min(kmax, n - 1) + 1):
        labels = S.cut(merges, n, k=k)
        if len(set(labels.tolist())) < 2:
            continue
        s = S.silhouette(D, labels)
        if s > best_s:
            best, best_s, best_k = labels, s, k
    if best is None:
        return np.zeros(n, dtype=int), -1.0, 1
    return best, best_s, best_k


# Two runs are "the same shape" when their combined distance is under this.
# Calibrated against the two natural reference points measured on real data:
# a one-piece edit of one's own maze sits near 0.06, two unrelated mazes near
# 0.31. A fixed height (rather than a per-day silhouette-optimal k) is what
# makes groups comparable ACROSS days -- otherwise "same shape" silently means
# something different every morning.
SAME_SHAPE = 0.18


def group(runs, weights=S.DEFAULT_WEIGHTS, height=SAME_SHAPE, kmax=None,
          min_partition=3):
    """Full pipeline for one iteration. Returns (traits, D, views, clusters).

    Pass kmax instead of height to fall back to the silhouette-optimal cut.
    """
    tr, Ds = S.views(runs)
    D = S.combine(Ds, weights)

    sigs = [signature(t) for t in tr]
    buckets = defaultdict(list)
    for i, s in enumerate(sigs):
        buckets[s].append(i)

    clusters = []
    for sig, idx in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        if len(idx) < min_partition:
            # Too few to subdivide meaningfully: the signature IS the cluster.
            clusters.append({"sig": sig, "idx": idx, "sil": None})
            continue
        sub = D[np.ix_(idx, idx)]
        merges = S.agglomerate(sub)
        if kmax is not None:
            labels, sil, _k = best_cut(sub, merges, len(idx), kmax=kmax)
        else:
            labels, sil = S.cut(merges, len(idx), height=height), None
        for c in sorted(set(labels.tolist())):
            members = [idx[j] for j in range(len(idx)) if labels[j] == c]
            # A lone run is not a shape the field shares -- it is one player's
            # one-off. Labelling it as noise (HDBSCAN's idea) is more honest
            # than minting a group of one, and keeps the taxonomy small.
            clusters.append({"sig": sig, "idx": members, "sil": sil,
                             "oneoff": len(members) == 1})

    clusters.sort(key=lambda c: -len(c["idx"]))
    return tr, D, Ds, clusters


def stability(runs, D, tr, trials=12, frac=0.8, seed=0):
    """Bootstrap co-association: how reproducible is the taxonomy?

    Cluster repeated subsamples and measure how consistently a pair of runs
    lands together (Ben-Hur-style consensus). A taxonomy that reshuffles when
    20% of the field is resampled is not a taxonomy worth naming, however good
    its silhouette looks on the full set.
    """
    rng = np.random.default_rng(seed)
    n = len(runs)
    sigs = [signature(t) for t in tr]
    together = np.zeros((n, n))
    seen = np.zeros((n, n))
    for _ in range(trials):
        pick = np.sort(rng.choice(n, int(frac * n), replace=False))
        labels = np.full(n, -1)
        nxt = 0
        for sig in sorted(set(sigs)):
            idx = [i for i in pick if sigs[i] == sig]
            if len(idx) < 3:
                for i in idx:
                    labels[i] = nxt
                    nxt += 1
                continue
            sub = D[np.ix_(idx, idx)]
            lb = S.cut(S.agglomerate(sub), len(idx), height=SAME_SHAPE)
            for j, i in enumerate(idx):
                labels[i] = nxt + lb[j]
            nxt += lb.max() + 1
        m = labels >= 0
        seen[np.ix_(pick, pick)] += 1
        agree = (labels[:, None] == labels[None, :]) & m[:, None] & m[None, :]
        together += agree
    with np.errstate(invalid="ignore", divide="ignore"):
        rate = np.where(seen > 0, together / np.maximum(seen, 1), np.nan)
    iu = np.triu_indices(n, 1)
    r = rate[iu]
    r = r[~np.isnan(r)]
    # Only pairs that ever co-occur are informative; the rest are trivially 0.
    active = r[r > 0]
    return float(np.mean(active >= 0.8)) if len(active) else 0.0, float(active.mean()) if len(active) else 0.0


# ---------------------------------------------------------------------------
# 3. naming
# ---------------------------------------------------------------------------

# Traits the namer is allowed to speak, with the phrase for high and low ends.
# Ordered by how strongly a player would recognise the description.
NAMEABLE = [
    ("spiral_depth", "tight coil", "loose weave"),
    ("pocket", "deep pocket", "shallow pocket"),
    ("hug", "wall-hugging", "through the middle"),
    ("west", "works the west side", "works the east side"),
    ("north", "works the north half", "works the south half"),
    ("n_turns", "switchback-heavy", "few turns"),
    ("total_turning", "wound tight", "open route"),
    ("max_wall", "one long wall", "scattered blocks"),
]

# Absolute cutoffs (low, high) per trait, at the 25th/75th percentile of the
# population the bands are actually APPLIED to: group representatives, i.e.
# best-in-group mazes (proxied by the top 8 distinct mazes per session, n=1440).
# Fixed constants, NOT per-session statistics -- which is the whole point.
#
# Calibrating on the whole corpus instead was the cause of the name repetition
# where four of eight groups all read "wound tight, one long wall": bands were
# fitted to every maze but applied to a biased sample, since a representative is
# by construction the best of its group. Measured against corpus p75, 41% of
# representatives cleared it on n_turns and 41% on total_turning -- against the
# 25% a correctly calibrated band gives -- so those two phrases fired for most
# groups and crowded out anything specific.
#
# Note what did NOT work: filtering to "competitive" mazes (>=60% of the way
# from the board's min to the player's best) moved the bands almost not at all,
# because 84% of the corpus already clears that bar. These are grinding
# sessions; players seldom build something bad. "Best" has to mean best-in-
# GROUP, not merely good.
#
# spiral_depth and max_wall are integer-valued, so their percentiles are coarse
# and their firing rates (35%/31%) cannot be tuned down this way.
#
# The first version scored traits by Cohen's d against the rest of the player's
# own field, so a name described a group only RELATIVE to its neighbours. Two
# consequences, both bad and both observed:
#
#   - the same shape got different names for different players, because the
#     comparison set differed (one player's mild eastward lean scored d=-0.52
#     and was spoken; the other's identical lean scored d=-0.39 and was not)
#   - a name DRIFTED as its own player added runs, because the comparison set
#     was still growing -- observed in all three sessions tested, one of them
#     flipping head phrase outright
#
# A name has to be a property of the thing named. So bands are global, and they
# are applied to the group's REPRESENTATIVE maze rather than to group means:
# the representative is a specific run (the best clean one), so its traits only
# move when the player actually beats it, whereas a mean shifts on every save.
BANDS = {
    "spiral_depth": (4.0, 6.0),
    "hug": (0.36, 0.49),
    "west": (0.39, 0.66),
    "north": (0.44, 0.60),
    "n_turns": (28.0, 51.0),
    "total_turning": (5.15, 10.45),
    "max_wall": (3.0, 5.0),
}


# How many trait phrases a name starts with before collision forces more. 0
# means the head phrase alone -- "clockwise spiral" -- which is the shortest a
# name can be and still say something.
#
# Zero is the right floor because the head IS the topological signature, the
# same two discrete bits that hard-partition the clustering: groups mostly
# differ by exactly the thing that forced them apart, so a trait phrase is
# redundant on most rows. Measured across both iterations, 82% of groups need
# nothing more than the head, and the remaining 18% take exactly one phrase --
# no group anywhere needed two. Starting at one instead spent a word on every
# row to buy uniqueness that 8% of rows actually needed.
START_PARTS = 0


def name_spec(cluster, tr, rep=None):
    """The raw material of a name: (head phrase, ranked trait phrases).

    Both are ABSOLUTE properties of the group's representative maze, banded
    against global cutoffs -- so a name describes the maze itself rather than
    how it compares to whatever else the player happens to have built, and does
    not drift as they add runs. See BANDS.
    """
    r = cluster["idx"][0] if rep is None else rep

    spoken = []
    for key, hi, lo in NAMEABLE:
        # The pocket trait is already spoken by the head phrase, so letting it
        # into the modifiers produces "fly-past, shallow pocket" -- a name that
        # contradicts itself.
        if key == "pocket":
            continue
        lo_cut, hi_cut = BANDS[key]
        v = float(tr[r][key])
        if v >= hi_cut:
            spoken.append((abs(v - hi_cut), key, hi))
        elif v <= lo_cut:
            spoken.append((abs(lo_cut - v), key, lo))
    # Most extreme first, so the strongest true statement leads.
    spoken.sort(reverse=True)

    pocket, hand = cluster["sig"].split("/")
    head = {"cw": "clockwise", "ccw": "counter-clockwise",
            "flat": "even-handed"}[hand]
    # Wrap magnitude is continuous, so it may shade the NAME even though it may
    # not drive the partition -- describing a borderline route as "spiral"
    # rather than "hook" costs nothing, whereas splitting a group on the same
    # borderline costs the player a duplicate row. Read off the representative,
    # not a group mean, so it cannot flip as membership shifts.
    wraps = abs(float(tr[r]["net_wraps_out"]))
    if pocket == "through":
        head = f"{head} fly-past"
    elif wraps >= 0.9:
        head = f"{head} spiral"
    else:
        head = f"{head} hook"
    return head, [phrase for _m, _k, phrase in spoken]


def name_groups(clusters, tr, reps=None, start=None, inherit_head=False,
                parent_phrases=()):
    """Name a whole panel at once, expanding collisions SYMMETRICALLY.

    Naming groups one at a time and having each dodge the names already issued
    made collisions asymmetric: of two peer groups sharing a head, the first
    kept the bare "even-handed hook" and only the second grew a phrase. That
    reads as though the first is THE even-handed hook and the second is a
    variant of it, when neither has any claim over the other -- the order they
    happened to be named in is not a fact about the mazes.

    So expansion is a fixed point over the whole panel: every member of a
    colliding set grows together, and the loop repeats because growing can
    create fresh collisions. Names start at START_PARTS phrases and buy only
    the length they need.

    Collisions compare the SET of phrases, not the rendered string: two groups
    whose traits rank in a different order would otherwise read as "spiral,
    tight coil, works the north half" and "spiral, works the north half, tight
    coil" -- different strings saying exactly the same thing.
    """
    start = START_PARTS if start is None else start
    specs = [
        name_spec(c, tr, (c.get("best") if reps is None else reps[i]))
        for i, c in enumerate(clusters)
    ]
    # Anything the parent row already said is not available to say again: a
    # subgroup of "even-handed hook, tight coil" reading "tight coil, few turns"
    # spends its first phrase restating its own heading.
    if parent_phrases:
        skip = set(parent_phrases)
        specs = [(h, [p for p in sp if p not in skip]) for h, sp in specs]
    counts = [min(start, len(sp)) for _h, sp in specs]

    def key_of(i):
        head, spoken = specs[i]
        return (head, frozenset(spoken[:counts[i]]))

    # Bounded by the vocabulary: each round grows at least one name by one
    # phrase, and no name can exceed its own phrase list.
    for _ in range(len(NAMEABLE) + 1):
        dup = {k for k, n in Counter(key_of(i) for i in range(len(specs))).items()
               if n > 1}
        if not dup:
            break
        grew = False
        for i in range(len(specs)):
            if key_of(i) in dup and counts[i] < len(specs[i][1]):
                counts[i] += 1
                grew = True
        if not grew:
            break  # vocabulary exhausted; numbered below

    # Expansion grows names until they differ, but it grows them by the most
    # extreme trait first -- which is often the SAME trait for everyone under a
    # head, since that is why they collided. A phrase carried by every member of
    # a head distinguishes none of them, so it is dead weight and comes back off:
    # two peers reading "hook, wall-hugging, tight coil" and "hook, wall-hugging,
    # works the south half" are separated entirely by the third phrase.
    #
    # Only phrases common to the WHOLE head are dropped, never merely-shared
    # ones. With three groups where two are wall-hugging and one is not, the
    # phrase is doing real work -- it says which two of the three go together --
    # so it stays. Dropping a common phrase cannot break uniqueness: the phrase
    # sets were distinct, and removing the same elements from each keeps them so.
    by_head = defaultdict(list)
    for i, (head, _sp) in enumerate(specs):
        by_head[head].append(i)
    dead = [set() for _ in specs]
    for _head, members in by_head.items():
        if len(members) < 2:
            continue
        common = set.intersection(
            *(set(specs[i][1][:counts[i]]) for i in members))
        for i in members:
            dead[i] = common

    # Drilling into one group, every subgroup inherits that group's head, so
    # repeating it on each row says only what the row above already said. Same
    # dead-weight rule as the phrases, one level up -- but it needs the caller
    # to opt in, because at top level there is no parent row to inherit FROM,
    # and a panel that happened to share one head would lose the only thing
    # telling the reader what they are looking at.
    # Keyed on the SIGNATURE, not the rendered head. The head shades "spiral"
    # vs "hook" off wrap magnitude at a hard 0.9, which is cosmetic -- and
    # inside one group the subgroup representatives straddle it, so a drill-down
    # of "clockwise spiral" showed rows reading "clockwise hook". The signature
    # is the topological truth and does not wobble; when every subgroup shares
    # it, they are all the parent's shape and the head is the parent's to state.
    show_head = not (inherit_head
                     and len({c["sig"] for c in clusters}) == 1)

    names = []
    for i, (head, spoken) in enumerate(specs):
        parts = [p for p in spoken[:counts[i]] if p not in dead[i]]
        if show_head:
            names.append(head + (", " + ", ".join(parts) if parts else ""))
        else:
            names.append(", ".join(parts) if parts else "(the plain version)")
    # Anything still identical said everything it could and is still tied.
    # Number those, all of them, so the numbering stays symmetric too.
    dup = {n for n, c in Counter(names).items() if c > 1}
    if dup:
        seen = Counter()
        for i, n in enumerate(names):
            if n in dup:
                seen[n] += 1
                names[i] = f"{n} ({seen[n]})"
    return names


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------

def render(run, path_overlay=True):
    """ASCII board: # base block, T base thunder, O player block, t player
    thunder, x checkpoint, . route."""
    g = [[" "] * S.N for _ in range(S.N)]
    for i in range(9):
        for (y, x) in ((0, i), (0, 19 - i), (19, i), (19, 19 - i),
                       (i + 1, 0), (18 - i, 0), (i + 1, 19), (18 - i, 19)):
            g[y][x] = "#"
    if path_overlay:
        q = S.resample(run["path"], 600)
        for px, py in q:
            xi, yi = int(round(px)), int(round(py))
            if 0 <= xi < S.N and 0 <= yi < S.N and g[yi][xi] == " ":
                g[yi][xi] = "."
    for x, y, t in run["base"]:
        for dx, dy in S.FOOTPRINT:
            if 0 <= y + dy < S.N and 0 <= x + dx < S.N:
                g[y + dy][x + dx] = "T" if t else "#"
    for x, y, t in run["pieces"]:
        for dx, dy in S.FOOTPRINT:
            if 0 <= y + dy < S.N and 0 <= x + dx < S.N:
                g[y + dy][x + dx] = "t" if t else "O"
    cp = run["checkpoint"]
    g[int(cp["y"])][int(cp["x"])] = "x"
    g[19][9] = "S" if g[19][9] in " ." else g[19][9]
    g[0][10] = "E" if g[0][10] in " ." else g[0][10]
    return ["|" + "".join(r) + "|" for r in g]


def side_by_side(blocks, gap="   "):
    height = max(len(b) for b in blocks)
    out = []
    for i in range(height):
        out.append(gap.join(b[i] if i < len(b) else " " * len(b[0]) for b in blocks))
    return "\n".join(out)


def report(iteration, runs, tr, D, Ds, clusters, top=6):
    print(f"\n{'='*100}")
    print(f"ITERATION {iteration}   {len(runs)} runs   "
          f"{len(set(r['user'] for r in runs))} players   "
          f"budget {runs[0]['bricks']} blocks / {runs[0]['power']} thunder   "
          f"min {runs[0]['min']}s")
    print(f"{'='*100}")
    print(f"{len(clusters)} shape groups\n")
    hdr = f"{'#':>3} {'runs':>5} {'plyr':>4} {'time p50':>9} {'range':>13} {'sig':<24} name"
    print(hdr)
    print("-" * len(hdr) + "-" * 30)
    taken = set()
    for ci, c in enumerate(clusters):
        idx = c["idx"]
        times = np.array([runs[i]["time"] for i in idx])
        users = len(set(runs[i]["user"] for i in idx))
        nm = name_cluster(c, tr, list(range(len(runs))), taken)
        c["name"] = nm
        print(f"{ci:>3} {len(idx):>5} {users:>4} {np.median(times):>9.2f} "
              f"{times.min():>6.2f}-{times.max():<6.2f} {c['sig']:<24} {nm}")

    print("\nmedoid boards (the most central real run in each group)\n")
    for c in clusters[:top]:
        idx = c["idx"]
        m = S.medoid(D, np.array(idx))
        c["medoid"] = m
        t = tr[m]
        print(f"  [{c['name']}]  n={len(idx)}  medoid time={runs[m]['time']}s  "
              f"wraps={t['net_wraps_out']:+.2f}  pocket={t['pocket']:.2f}  "
              f"coil={t['spiral_depth']}")
        print("  turn word: " + (t["word"][:88] + ("..." if len(t["word"]) > 88 else "")))
        for line in render(runs[m]):
            print("  " + line)
        print()


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------

def validate(runs, tr, D, Ds, clusters):
    """Four checks that the metric measures approach rather than noise."""
    n = len(runs)
    labels = np.zeros(n, dtype=int)
    for ci, c in enumerate(clusters):
        for i in c["idx"]:
            labels[i] = ci

    print("  validation")

    # (a) Does the GEOMETRY alone rediscover handedness? Asking this of the
    #     full pipeline would be circular -- handedness is one of the three
    #     bits of the hard signature, so purity would be 100% by construction
    #     and prove nothing. So re-cluster with the pre-partition switched off
    #     and score against handedness as a held-out label. Recovery means the
    #     continuous views really do carry the qualitative distinction; failure
    #     to recover means the pre-partition is load-bearing rather than
    #     cosmetic, which is worth knowing either way.
    hand = np.array([1 if t["net_wraps_out"] > 0 else 0 for t in tr])
    base = max(hand.mean(), 1 - hand.mean())
    merges = S.agglomerate(D)
    blind, _sil, k = best_cut(D, merges, n, kmax=8)
    pure = sum(
        max(hand[blind == c].mean(), 1 - hand[blind == c].mean()) * (blind == c).sum()
        for c in set(blind.tolist())
    )
    print(f"    handedness recovered blind (k={k})   {pure/n:6.1%}  "
          f"(chance {base:.1%})")

    # (b) Does shape explain time? If the taxonomy is strategically real, the
    #     groups should have separated time distributions.
    times = np.array([r["time"] for r in runs])
    grand = times.mean()
    ssb = sum(len(c["idx"]) * (times[c["idx"]].mean() - grand) ** 2 for c in clusters)
    sst = ((times - grand) ** 2).sum()
    print(f"    variance in TIME explained         {ssb/sst:6.1%}")

    # (c) Are the views telling us different things? Highly correlated views
    #     mean the weighting is doing nothing and one should be dropped.
    keys = list(Ds)
    iu = np.triu_indices(n, 1)
    flat = {k: Ds[k][iu] for k in keys}
    print("    inter-view correlation")
    print("              " + "".join(f"{k[:7]:>9}" for k in keys))
    for a in keys:
        row = "".join(f"{np.corrcoef(flat[a], flat[b])[0,1]:>9.2f}" for b in keys)
        print(f"      {a:<8}" + row)

    # (d) Near-duplicate sanity floor: consecutive runs by one player differing
    #     by one piece should be close. If they are not, the metric is noise.
    same, diff = [], []
    for i in range(n):
        for j in range(i + 1, n):
            a = {tuple(p) for p in runs[i]["pieces"]}
            b = {tuple(p) for p in runs[j]["pieces"]}
            if len(a ^ b) <= 2 and runs[i]["user"] == runs[j]["user"]:
                same.append(D[i, j])
            elif len(a ^ b) >= 0.75 * (len(a) + len(b)):
                diff.append(D[i, j])
    if same and diff:
        print(f"    dist, one-piece edits  (n={len(same):>5})  {np.mean(same):.3f}")
        print(f"    dist, unrelated mazes  (n={len(diff):>5})  {np.mean(diff):.3f}")

    # (e) Ablation: is each view pulling its weight? For each view alone, how
    #     well does it separate near-duplicate mazes from unrelated ones, and
    #     how much time variance does a clustering on it explain? A view that
    #     scores like the combination is redundant; one that scores at chance
    #     is noise being averaged in.
    print("    per-view ablation      separation   time-var")
    pair_same, pair_diff = [], []
    for i in range(n):
        for j in range(i + 1, n):
            a = {tuple(p) for p in runs[i]["pieces"]}
            b = {tuple(p) for p in runs[j]["pieces"]}
            if len(a ^ b) <= 2 and runs[i]["user"] == runs[j]["user"]:
                pair_same.append((i, j))
            elif len(a ^ b) >= 0.75 * (len(a) + len(b)):
                pair_diff.append((i, j))
    times = np.array([r["time"] for r in runs])
    for key in list(Ds) + ["ALL"]:
        M = D if key == "ALL" else Ds[key]
        if pair_same and pair_diff:
            s = np.mean([M[i, j] for i, j in pair_same])
            d = np.mean([M[i, j] for i, j in pair_diff])
            sep = (d - s) / max(d, 1e-9)
        else:
            sep = float("nan")
        mg = S.agglomerate(M)
        lb, _s, _k = best_cut(M, mg, n, kmax=6)
        gm = times.mean()
        ssb = sum((lb == c).sum() * (times[lb == c].mean() - gm) ** 2
                  for c in set(lb.tolist()))
        sst = ((times - gm) ** 2).sum()
        print(f"      {key:<20} {sep:>10.2f} {ssb/sst:>10.1%}")


if __name__ == "__main__":
    by = S.load()
    targets = [int(a) for a in sys.argv[1:]] or [180, 193, 186]
    for it in targets:
        runs = by[it]
        tr, D, Ds, clusters = group(runs)
        report(it, runs, tr, D, Ds, clusters)
        validate(runs, tr, D, Ds, clusters)
