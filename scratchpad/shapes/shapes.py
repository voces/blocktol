"""Run-shape descriptors, similarity, clustering and naming for Blocktol.

Pure numpy (no scipy/sklearn available here). The unit of analysis is one run
within one iteration: the base board, checkpoint and budget are fixed, so two
runs differ only in where the player put pieces -- and, downstream of that, in
the route they force the runner to take.

The organising idea: a run's *shape* is a property of the induced PATH, not of
the brick set. Bricks are the input, the path is the strategy. Descriptors are
therefore grouped into "views", each a separate metric space, combined at the
end with weights so any one view can be turned off and studied alone.
"""

import json
import math
from collections import Counter, defaultdict

import numpy as np

N = 20  # board is 20x20
START = (9, 19)
END = (10, 0)


# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------

def load(path="paths.jsonl"):
    runs = [json.loads(l) for l in open(path)]
    by_iter = defaultdict(list)
    for r in runs:
        r["path"] = np.asarray(r["path"], dtype=float)
        by_iter[r["iteration"]].append(r)
    return by_iter


# ---------------------------------------------------------------------------
# polyline geometry
# ---------------------------------------------------------------------------

def seg_lengths(p):
    d = np.diff(p, axis=0)
    return np.hypot(d[:, 0], d[:, 1])


def arclength(p):
    """Cumulative arclength, length n (starts at 0)."""
    return np.concatenate([[0.0], np.cumsum(seg_lengths(p))])


def resample(p, m):
    """Resample a polyline to m points equally spaced in arclength."""
    s = arclength(p)
    total = s[-1]
    if total <= 0:
        return np.repeat(p[:1], m, axis=0)
    targets = np.linspace(0, total, m)
    xs = np.interp(targets, s, p[:, 0])
    ys = np.interp(targets, s, p[:, 1])
    return np.stack([xs, ys], axis=1)


def signed_turns(p, eps=1e-9):
    """Signed turn angle at each interior vertex, in radians.

    Screen coordinates (y grows downward), so a POSITIVE angle here is a
    clockwise turn on screen. A 180-degree reversal (only physically possible
    where the runner touches the checkpoint and comes back out) is reported as
    +pi so it never silently reads as a straight-through.
    """
    d = np.diff(p, axis=0)
    if len(d) < 2:
        return np.zeros(0)
    a, b = d[:-1], d[1:]
    cross = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
    dot = a[:, 0] * b[:, 0] + a[:, 1] * b[:, 1]
    ang = np.arctan2(cross, dot)
    # arctan2 gives -pi for a reversal from one side and +pi from the other;
    # pin it to +pi so the reversal is a single stable symbol.
    ang[np.abs(np.abs(ang) - math.pi) < 1e-6] = math.pi
    ang[np.abs(ang) < eps] = 0.0
    return ang


# ---------------------------------------------------------------------------
# View 1 -- the turn word, and its continuous cousin the turning function
# ---------------------------------------------------------------------------

def turn_word(p, min_angle=math.radians(8)):
    """The route as a word over {R, L, F}: the user's "left left right flip".

    R/L are clockwise/counter-clockwise turns on screen; F is the 180 at the
    checkpoint. Turns shallower than `min_angle` are dropped -- a taut path
    grazes many corners with a ~2 degree deflection and those are noise, not
    decisions.
    """
    out = []
    for a in signed_turns(p):
        if abs(abs(a) - math.pi) < 1e-6:
            out.append("F")
        elif a > min_angle:
            out.append("R")
        elif a < -min_angle:
            out.append("L")
    return "".join(out)


def rle(word):
    """Run-length encode a turn word: 'LLLRRL' -> [('L',3),('R',2),('L',1)]."""
    out = []
    for ch in word:
        if out and out[-1][0] == ch:
            out[-1][1] += 1
        else:
            out.append([ch, 1])
    return [(c, n) for c, n in out]


def kmer_vector(word, ks=(1, 2, 3), vocab=None):
    """Spectrum-kernel featurisation of a turn word.

    Exact edit distance between words is O(len^2) per pair, which is too slow
    for an all-pairs matrix at this scale. The k-mer count vector is the
    standard substitute (Leslie et al.'s spectrum kernel): build once per run,
    then every pairwise similarity is one matrix product. Counts are
    L2-normalised so cosine reads as a similarity.
    """
    counts = Counter()
    for k in ks:
        for i in range(len(word) - k + 1):
            counts[word[i:i + k]] += 1
    if vocab is None:
        return counts
    v = np.zeros(len(vocab))
    for kmer, c in counts.items():
        j = vocab.get(kmer)
        if j is not None:
            v[j] = c
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def turning_function(p, m=64):
    """Arc-length-parameterised cumulative turning, resampled to m samples.

    The classic turning-function shape descriptor (Arkin et al.): it is signed,
    so a clockwise and a counter-clockwise route are far apart -- unlike any
    order-free measure such as Hausdorff distance, which would call them
    identical. Divided by 2*pi, so one unit is one full wrap.
    """
    s = arclength(p)
    turns = signed_turns(p)
    if len(turns) == 0 or s[-1] <= 0:
        return np.zeros(m)
    # Turn i happens at vertex i+1, i.e. at arclength s[i+1].
    at = s[1:-1]
    cum = np.cumsum(turns)
    targets = np.linspace(0, s[-1], m)
    return np.interp(targets, at, cum, left=0.0, right=cum[-1]) / (2 * math.pi)


def edit_distance(a, b):
    """Levenshtein, for the small-n exact option and for naming diagnostics."""
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = np.arange(len(b) + 1)
    cur = np.empty_like(prev)
    for i, ca in enumerate(a, 1):
        cur[0] = i
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1,
                         prev[j - 1] + (ca != cb))
        prev, cur = cur, prev
    return int(prev[-1])


# ---------------------------------------------------------------------------
# View 2 -- retrace / spur structure ("did you pocket the checkpoint?")
# ---------------------------------------------------------------------------

def split_legs(r):
    """Index of the checkpoint vertex, splitting the path into its two legs."""
    cp = np.array([r["checkpoint"]["x"], r["checkpoint"]["y"]], dtype=float)
    d = np.hypot(r["path"][:, 0] - cp[0], r["path"][:, 1] - cp[1])
    return int(np.argmin(d))


def retrace_fraction(r):
    """Fraction of total arclength the two legs spend on the same ground.

    A checkpoint walled into a pocket forces the runner in and back out the
    identical way; a checkpoint on a through-route does not. This one scalar
    separates the two dominant strategies, so it earns its own view.

    Measured as the shared prefix (from the checkpoint outwards) of leg B
    reversed against leg A, matched vertex-for-vertex.
    """
    k = split_legs(r)
    p = r["path"]
    a = p[:k + 1][::-1]       # checkpoint back to start
    b = p[k:]                 # checkpoint out to end
    m = min(len(a), len(b))
    shared = 0
    for i in range(m):
        if np.allclose(a[i], b[i]):
            shared = i
        else:
            break
    if shared == 0:
        return 0.0
    shared_len = arclength(b[:shared + 1])[-1]
    total = arclength(p)[-1]
    return float(2 * shared_len / total) if total > 0 else 0.0


# ---------------------------------------------------------------------------
# View 3 -- where on the board (occupancy)
# ---------------------------------------------------------------------------

def _gauss_kernel(sigma, radius=None):
    if radius is None:
        radius = max(1, int(3 * sigma))
    x = np.arange(-radius, radius + 1)
    k = np.exp(-(x ** 2) / (2 * sigma ** 2))
    return k / k.sum()


def _blur2d(grid, sigma):
    k = _gauss_kernel(sigma)
    pad = len(k) // 2
    g = np.pad(grid, pad, mode="constant")
    g = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 1, g)
    g = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 0, g)
    return g


def path_occupancy(p, sigma=1.2, samples=400):
    """Arc-length-weighted visit density over the board, blurred.

    Blur matters: a raw 20x20 indicator of a ~30-cell route is sparse enough
    that two routes one cell apart share almost nothing. Smoothing turns the
    cosine into a tolerant "same region of the board" measure. Direction is
    deliberately discarded here -- that is View 1's job.
    """
    q = resample(p, samples)
    grid = np.zeros((N, N))
    xi = np.clip(q[:, 0].astype(int), 0, N - 1)
    yi = np.clip(q[:, 1].astype(int), 0, N - 1)
    np.add.at(grid, (yi, xi), 1.0)
    g = _blur2d(grid, sigma).ravel()
    n = np.linalg.norm(g)
    return g / n if n > 0 else g


# A piece is anchored at (x, y) but occupies the 2x2 cells (x..x+1, y..y+1) --
# see `offsets` in common/constants.ts and how PathSolver stamps the grid. Every
# piece-space descriptor has to use the footprint, not the anchor, or adjacency
# and overlap both come out wrong.
FOOTPRINT = ((0, 0), (1, 0), (0, 1), (1, 1))


def brick_mask(pieces, sigma=1.0, weights=None):
    """Blurred (optionally importance-weighted) map of the player's pieces."""
    grid = np.zeros((N, N))
    for i, (x, y, _t) in enumerate(pieces):
        w = 1.0 if weights is None else float(weights[i])
        for dx, dy in FOOTPRINT:
            gy, gx = int(y) + dy, int(x) + dx
            if 0 <= gy < N and 0 <= gx < N:
                grid[gy, gx] += w
    g = _blur2d(grid, sigma).ravel()
    n = np.linalg.norm(g)
    return g / n if n > 0 else g


# ---------------------------------------------------------------------------
# View 4 -- brick structure (walls)
# ---------------------------------------------------------------------------

def wall_components(pieces):
    """Connected components of the piece set: the player's "walls".

    Two pieces belong to the same wall when their 2x2 footprints touch, even
    only diagonally -- a diagonal touch leaves a zero-width gap the unit runner
    cannot squeeze through (see the pathing engine's grazing rule), so it is a
    real barrier and the two pieces are structurally one wall. Footprints touch
    exactly when both anchor offsets are within 2.

    Returns one dict per wall with its size, bounding box and orientation --
    how players actually describe their own builds ("one long diagonal", "two
    stubs off the north wall").
    """
    cells = {(int(x), int(y)) for x, y, _t in pieces}
    seen, walls = set(), []
    for c in sorted(cells):
        if c in seen:
            continue
        stack, comp = [c], []
        seen.add(c)
        while stack:
            cx, cy = stack.pop()
            comp.append((cx, cy))
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    nb = (cx + dx, cy + dy)
                    if nb in cells and nb not in seen:
                        seen.add(nb)
                        stack.append(nb)
        arr = np.array(comp, dtype=float)
        # +2, not +1: the anchor's footprint reaches one cell further.
        span_x = arr[:, 0].max() - arr[:, 0].min() + 2
        span_y = arr[:, 1].max() - arr[:, 1].min() + 2
        walls.append({
            "size": len(comp),
            "span_x": float(span_x),
            "span_y": float(span_y),
            "elongation": float(max(span_x, span_y) / max(1.0, min(span_x, span_y))),
            "vertical": bool(span_y > span_x),
            "centroid": (float(arr[:, 0].mean()), float(arr[:, 1].mean())),
        })
    return walls


# ---------------------------------------------------------------------------
# interpretable traits (these are what the auto-namer speaks)
# ---------------------------------------------------------------------------

def traits(r):
    p = r["path"]
    k = split_legs(r)
    word = turn_word(p)
    tf = turning_function(p)
    s = arclength(p)
    total = s[-1]

    turns_a = signed_turns(p[:k + 1])
    net_a = float(turns_a.sum() / (2 * math.pi)) if len(turns_a) else 0.0

    # Deepest run of same-direction turns: spiral depth.
    runs_rle = [(c, n) for c, n in rle(word) if c in "LR"]
    depth = max([n for _c, n in runs_rle], default=0)
    hand = max(runs_rle, key=lambda cn: cn[1])[0] if runs_rle else "-"

    # Wall hugging: share of arclength within 1.5 cells of the border ring.
    q = resample(p, 400)
    edge = np.minimum.reduce([q[:, 0], q[:, 1], (N - 1) - q[:, 0], (N - 1) - q[:, 1]])
    hug = float((edge <= 2.5).mean())

    # Which side / half of the board the route works.
    cx, cy = q[:, 0].mean(), q[:, 1].mean()
    west = float((q[:, 0] < (N - 1) / 2).mean())
    north = float((q[:, 1] < (N - 1) / 2).mean())

    walls = wall_components(r["pieces"])
    thunders = [(x, y) for x, y, t in r["pieces"] if t]

    # Positional facts. Everything above describes the route's overall CHARACTER,
    # which is what a shape holds constant -- so within one shape those traits go
    # flat and cannot tell two versions apart. What varies inside a shape is
    # where things sit, and these measure that: the bearing the runner is
    # travelling as it reaches the checkpoint, and where the player's biggest
    # wall lies. Measured across 26 real groups, the wall position has genuine
    # spread in 22 of them and the approach bearing in 24, both at |r| < 0.31
    # with time -- so they say something new rather than restating the score.
    big = max(walls, key=lambda w: w["size"]) if walls else None
    k = split_legs(r)
    j = max(0, k - 3)
    v = p[k] - p[j]
    # atan2 on -dy so that 90 degrees reads as north on a screen-coords board.
    approach = float(np.degrees(np.arctan2(-v[1], v[0]))) % 360 if np.any(v) else 0.0

    return {
        "word": word,
        "n_turns": len(word),
        "flips": word.count("F"),
        "pocket": retrace_fraction(r),
        "net_wraps_out": net_a,
        "total_turning": float(np.abs(signed_turns(p)).sum() / (2 * math.pi)),
        "spiral_depth": depth,
        "handedness": hand,
        "length": float(total),
        "detour": float(r["time"] / r["min"]) if r["min"] else 0.0,
        "hug": hug,
        "west": west,
        "north": north,
        "centroid": (float(cx), float(cy)),
        "n_walls": len(walls),
        "max_wall": max([w["size"] for w in walls], default=0),
        "vertical_walls": sum(1 for w in walls if w["vertical"]),
        "approach": approach,
        "wall_cx": float(big["centroid"][0]) if big else 9.5,
        "wall_cy": float(big["centroid"][1]) if big else 9.5,
        "n_thunder": len(thunders),
        "n_slows": len(r["slows"]),
        "turning_fn": tf,
    }


# ---------------------------------------------------------------------------
# similarity: build per-view distance matrices, then combine
# ---------------------------------------------------------------------------

def cosine_distance_matrix(V):
    """V rows are L2-normalised, so this is 1 - cosine similarity."""
    S = V @ V.T
    np.clip(S, -1.0, 1.0, out=S)
    return 1.0 - S


def views(runs, loo_weights=None):
    """All per-view distance matrices for one iteration's runs, in [0,1]-ish."""
    n = len(runs)
    tr = [traits(r) for r in runs]

    # -- turn word (k-mer spectrum cosine)
    vocab_counts = Counter()
    per_run = []
    for t in tr:
        c = kmer_vector(t["word"])
        per_run.append(c)
        vocab_counts.update(c.keys())
    vocab = {k: i for i, k in enumerate(sorted(vocab_counts))}
    W = np.zeros((n, len(vocab)))
    for i, c in enumerate(per_run):
        for kmer, v in c.items():
            W[i, vocab[kmer]] = v
    W /= np.maximum(np.linalg.norm(W, axis=1, keepdims=True), 1e-12)
    D_word = cosine_distance_matrix(W)

    # -- turning function (signed, so direction-aware); scaled to ~[0,1]
    T = np.stack([t["turning_fn"] for t in tr])
    diff = T[:, None, :] - T[None, :, :]
    D_turn = np.sqrt((diff ** 2).mean(axis=2))
    D_turn /= max(D_turn.max(), 1e-12)

    # -- path occupancy (where on the board)
    O = np.stack([path_occupancy(r["path"]) for r in runs])
    D_occ = cosine_distance_matrix(O)

    # -- brick placement (configuration space)
    B = np.stack([
        brick_mask(r["pieces"], weights=None if loo_weights is None else loo_weights[i])
        for i, r in enumerate(runs)
    ])
    D_brick = cosine_distance_matrix(B)

    # -- pocket / retrace structure (1-D, so |difference|)
    pk = np.array([t["pocket"] for t in tr])
    D_pocket = np.abs(pk[:, None] - pk[None, :])

    return tr, {
        "word": D_word,
        "turning": D_turn,
        "occupancy": D_occ,
        "brick": D_brick,
        "pocket": D_pocket,
    }


DEFAULT_WEIGHTS = {
    # The route carries the "approach"; bricks are the means, so they get less
    # say. Pocket structure is a single bit of enormous strategic weight.
    "word": 0.30,
    "turning": 0.20,
    "occupancy": 0.25,
    "pocket": 0.15,
    "brick": 0.10,
}


def combine(Ds, weights=DEFAULT_WEIGHTS):
    total = sum(weights[k] for k in weights if k in Ds)
    D = sum(weights[k] * Ds[k] for k in weights if k in Ds) / total
    np.fill_diagonal(D, 0.0)
    return D


# ---------------------------------------------------------------------------
# clustering: average-linkage agglomerative, Lance-Williams updates
# ---------------------------------------------------------------------------

def agglomerate(D):
    """Average-linkage hierarchy. Returns merge list [(a, b, height)].

    Average linkage (UPGMA) rather than Ward because the combined distance is
    not Euclidean, and rather than single linkage because that chains
    dissimilar builds together through near-duplicate intermediates -- and
    near-duplicates are exactly what this data has (one player re-running a
    tweak of their own maze).
    """
    n = D.shape[0]
    D = D.astype(float).copy()
    np.fill_diagonal(D, np.inf)
    active = np.ones(n, dtype=bool)
    size = np.ones(n)
    members = {i: [i] for i in range(n)}
    merges = []
    for _ in range(n - 1):
        M = np.where(active[:, None] & active[None, :], D, np.inf)
        flat = int(np.argmin(M))
        a, b = divmod(flat, n)
        h = M[a, b]
        if not np.isfinite(h):
            break
        merges.append((a, b, float(h), members[a] + members[b]))
        new = (size[a] * D[a] + size[b] * D[b]) / (size[a] + size[b])
        D[a] = new
        D[:, a] = new
        D[a, a] = np.inf
        size[a] += size[b]
        members[a] = members[a] + members[b]
        active[b] = False
    return merges


def cut(merges, n, k=None, height=None):
    """Cut the hierarchy into flat clusters, by count or by distance."""
    labels = np.arange(n)
    groups = {i: [i] for i in range(n)}
    count = n
    for a, b, h, mem in merges:
        if k is not None and count <= k:
            break
        if height is not None and h > height:
            break
        for i in mem:
            labels[i] = a
        count -= 1
    # compact labels
    uniq = {v: i for i, v in enumerate(sorted(set(labels.tolist())))}
    return np.array([uniq[v] for v in labels])


def silhouette(D, labels):
    """Mean silhouette width from a precomputed distance matrix."""
    n = len(labels)
    ks = np.unique(labels)
    if len(ks) < 2 or len(ks) >= n:
        return -1.0
    scores = []
    for i in range(n):
        same = labels == labels[i]
        same[i] = False
        if same.sum() == 0:
            scores.append(0.0)
            continue
        a = D[i, same].mean()
        b = min(D[i, labels == k].mean() for k in ks if k != labels[i])
        scores.append((b - a) / max(a, b))
    return float(np.mean(scores))


def medoid(D, idx):
    """The most central real run in a cluster -- its canonical example."""
    sub = D[np.ix_(idx, idx)]
    return idx[int(np.argmin(sub.sum(axis=1)))]
