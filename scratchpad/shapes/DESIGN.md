# Run shapes: similarity, grouping, and naming

Goal: a player with 380 attempts on one board should see ~8 rows — "here are the
different things you tried, here's your best with each" — not 380 rows of
`{time, timestamp}`. That needs a similarity score between two arbitrary runs, a
grouping built on it, and a name per group.

Scope is **one player, one iteration**. Players never see each other's mazes
(only each other's times), so nothing here compares across players, and the
whole computation is per-session and small.

---

## 1. The decision that determines everything: what is a shape?

Two candidate answers, and they disagree often enough that the choice matters.

**Configuration space** — the shape is the brick set. Similarity is image or
point-set similarity.

**Behaviour space** — the shape is the route the bricks force. Similarity is
curve similarity.

Behaviour is the right primary answer, because "clockwise spiral vs
counter-clockwise spiral" is a statement about the route, not the bricks. Two
players can build visibly different brick sets that route the runner identically
— same approach. And one brick moved one cell can flip the runner from passing
left of a wall to passing right of it — a large change in approach from a tiny
change in configuration. **Bricks are the input; the path is the strategy.** The
path is the semantic quotient of the brick set.

But configuration is not discardable, for one specific reason: **holes** (§7). A
leak makes the realised path diverge wildly from the intended one while the
bricks stay nearly identical. That is exactly the case where the two views
disagree, and it is why the final design keeps both.

---

## 2. Candidate approaches, and whether they apply

### Configuration space

| Approach                                       | Verdict                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jaccard / IoU on the brick mask**            | Too sparse to work raw — 15 pieces in 400 cells means two good mazes one cell apart share almost nothing. Needs blur.                                                                                                                                                                                                   |
| **Blurred mask cosine** (Gaussian, σ≈1)        | Works, cheap, tolerant of 1-cell jitter. Kept as a minor view.                                                                                                                                                                                                                                                          |
| **Earth Mover's Distance / optimal transport** | Better metric properties than IoU and handles unequal counts; Hungarian on ≤71 points is trivial. But it measures "how far would you slide the bricks", which is not how players think, and blurred cosine already captures the same signal. Not worth the complexity here.                                             |
| **Leave-one-out / Shapley brick importance**   | Genuinely interesting: remove a brick, re-solve, and its Δtime is its load-bearing weight. Lets you compare only the bricks that _matter_ and ignore decorative filler. Cheap (the engine does 11k solves in 2.5s). Not needed for the core grouping, but it is the same machinery as the leak probe and worth reusing. |

### Behaviour space (path geometry)

| Approach                                 | Verdict                                                                                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hausdorff distance**                   | **Wrong for this problem.** It compares point _sets_, so it is blind to order and direction: a clockwise loop and a counter-clockwise loop over the same cells score 0 apart. That is precisely the distinction we most need. |
| **Discrete Fréchet distance**            | The correct order-preserving curve metric ("dog-walking distance"). Cheap on these polylines (median 35 vertices). Good, but it is a _geometric_ distance — it does not hand you "clockwise" as a nameable fact.              |
| **Dynamic time warping**                 | More tolerant of pacing differences, but not a metric, and pacing is not what varies here. No advantage over Fréchet.                                                                                                         |
| **Turning function** (Arkin et al. 1991) | Arc-length-parameterised cumulative turning θ(s). Signed, so CW and CCW sit far apart; fixed-length vector, so any clustering works. **Adopted.**                                                                             |
| **Shape context / Fourier descriptors**  | Designed for closed contours and rotation invariance. Rotation invariance is actively _wrong_ here — the board has a fixed start, end and checkpoint, so orientation is meaningful. Rejected.                                 |

### Topology

| Approach                                                    | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Homotopy class / h-signature** (Bhattacharya et al. 2010) | The exact formalisation of "same approach": two routes are equivalent iff one deforms into the other without crossing an obstacle. Compute by recording signed crossings of rays from obstacle representative points and reducing the word. Complication: the player's own bricks change the obstacle set, so signatures are only comparable if taken against the _fixed_ board. Exact, but it fragments a session into near-singletons. Used in spirit, not in full — see §3. |
| **Signed winding number**                                   | The cheap scalar version: net turning about the checkpoint, ÷2π. On real data it is sharply bimodal at roughly ±1, which is exactly the clockwise/counter-clockwise split. **Adopted** as the partition key.                                                                                                                                                                                                                                                                   |

### Sequence (your turn-word idea)

Your framing — "left left left right flip left left right" — is the right one,
and it has a name in the literature: it is a discrete **curvature word**, and
the cheap legible cousin of the homotopy signature. Each path vertex is an
obstacle corner the runner rounds, and rounding is either left or right; the `F`
is the 180 at the checkpoint, which as you say is the only place a reversal is
possible.

Measured: median 34 turns per run, and **600 distinct words across 792 runs** —
so exact word equality is far too fine to be a grouping key, which confirms you
need a graded distance over words rather than equality.

| Approach                                       | Verdict                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Levenshtein edit distance on the word**      | The natural graded distance, and robust to an inserted jog. But O(len²) per pair × O(n²) pairs is too slow for an all-pairs matrix at n≈800. Kept for diagnostics.                                       |
| **k-mer spectrum kernel** (Leslie et al. 2002) | Represent the word by its k-mer count vector (k=1,2,3), L2-normalise, take cosine. Built once per run, then all pairs are one matrix product. **Adopted** as the practical substitute for edit distance. |
| **Run-length encoding**                        | `LLLRRL → L3 R2 L1`. Shorter, more legible, and directly exposes spiral depth (longest same-direction run). Used for traits/naming.                                                                      |

### Learned embeddings

A small conv autoencoder or contrastive (SimCLR-style) embedding over the 20×20
mask + path channel would work, and 11k runs is enough to train something tiny.
Rejected as the primary: the clusters would be unnameable and unexplainable,
which defeats the point — the names _are_ the feature. Hand-built descriptors
here are interpretable, deterministic, need no training, and (as §8 shows)
already validate well.

---

## 3. Recommended design: topology partitions, geometry refines

```
runs ──► recompute exact paths (the real engine)
      ──► descriptors in 5 views
      ──► weighted combined distance  D(a,b) ∈ [0,1]
      ──► + large penalty when topological signatures differ
      ──► average-linkage hierarchy ──► cut to target group count
      ──► per group: best clean maze + name
```

**The signature** is a hard-ish partition on genuinely _discrete_ properties
only:

- **pocket vs through** — does the route reverse out of a dead-end at the
  checkpoint, or flow through it? Present or absent; a topological fact.
- **cw / ccw / flat** — the sign of net winding, with a small dead band around
  zero because the sign of a near-zero quantity is unstable.

An earlier version added a third bit, "deep vs shallow" at |wraps| ≥ 0.9, and it
immediately split two routes whose turn words differed by a single leading turn.
**A hard partition on a thresholded continuous quantity is a knife edge.** Wrap
magnitude is continuous, so it belongs in the turning-function view, which
grades it — and it may still shade the _name_, because describing a borderline
route as "spiral" rather than "hook" costs nothing while splitting a group on
the same borderline costs the player a duplicate row.

The signature enters as a **large additive penalty** rather than a true
partition, so one global dendrogram still controls the group count while
agglomeration exhausts every within-signature merge first.

---

## 4. The similarity function

Five views, each a distance matrix, combined by weight. Everything is normalised
so `D ∈ [0,1]`.

| View        | What it measures                                   | Distance                                   | Weight |
| ----------- | -------------------------------------------------- | ------------------------------------------ | ------ |
| `word`      | the turn sequence — your L/R/F word                | cosine on k-mer spectrum                   | 0.30   |
| `occupancy` | which part of the board the route works            | cosine on blurred arc-length visit density | 0.25   |
| `turning`   | how much it winds, and which way, along its length | RMS between turning functions              | 0.20   |
| `pocket`    | how much of the route is the there-and-back spur   | \|Δ\| of retrace fraction                  | 0.15   |
| `brick`     | where the pieces sit                               | cosine on blurred 2×2-footprint mask       | 0.10   |

The weights are a starting point, not a derived optimum — §8 shows what each
view actually contributes, and they are the obvious tuning knob.

**A single-view alternative is viable** if you want something far simpler:
`turning` alone recovers a lot, and `pocket` alone explains more of the time
variance than everything else combined. A 2-view version (`word` + `pocket`)
would be defensible and much less code. The 5-view version buys robustness, not
a different answer.

---

## 5. Clustering

| Method                                    | Verdict                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Average-linkage agglomerative (UPGMA)** | **Adopted.** No _k_ needed up front, works from a precomputed distance (ours is not Euclidean, which rules out Ward and k-means), and — the deciding factor — it produces a _hierarchy_, so the UI gets a free "coarser / finer" control and "expand this group" for nothing. |
| Single linkage                            | Rejected: chains dissimilar builds together through near-duplicate intermediates, and near-duplicates are exactly what this data has.                                                                                                                                         |
| **HDBSCAN**                               | Strong alternative — handles variable density and labels one-offs as noise rather than forcing them into groups. Its noise concept is worth stealing (and is), but it gives no hierarchy to expand and no group-count control.                                                |
| **Affinity propagation**                  | Picks real _exemplars_, which suits a UI that shows one maze per group. But we already want the best run as the exemplar, not the most central one, so the feature is redundant.                                                                                              |
| **Spectral / k-medoids**                  | Both need _k_ and neither adds anything over the above.                                                                                                                                                                                                                       |

**Choosing granularity.** Two defensible controls:

- **Fixed distance height** — "same shape means D < 0.18". Calibrated against
  two natural reference points measured on real data: a one-piece edit of your
  own maze sits at ≈0.06, two unrelated mazes at ≈0.31. This is the right
  control if groups must ever be compared _across days_, since a per-day optimal
  _k_ would silently redefine "same shape" every morning.
- **Target group count** — cut the dendrogram to ~8. **Adopted here**, because
  nothing in this feature is compared across anything: it is one player's own
  board, and the honest control is the one they care about — how many rows they
  get.

Silhouette-optimal _k_ was tried and rejected: it under-splits a dominant blob,
leaving one group holding 66% of the field.

---

## 6. Naming

Names come from **discriminative** traits, not large ones: for each candidate
trait, a standardised mean difference (Cohen's _d_) between the group and the
rest of the field, then the top two are spoken. This is the same idea as
labelling a topic by its distinctive terms rather than its most frequent ones —
a group is best described by what makes it _not_ the others. A trait with |d| <
0.45 is dropped rather than asserted, so a name never invents a claim.

Structure is `<head>, <trait>, <trait>`:

- head from the signature — `clockwise spiral`, `counter-clockwise hook`,
  `even-handed fly-past`
- traits from a fixed vocabulary — `tight coil`, `wall-hugging`,
  `works the west side`, `switchback-heavy`, `one long wall`, `scattered blocks`

Real output:

```
 best  mazes  tries  leaked  approach
39.00    152    170       6  counter-clockwise hook, one long wall
38.52    146    166       9  clockwise spiral, scattered blocks, switchback-heavy
37.94     36     36       1  even-handed hook, few turns, works the south half
18.91      2      2       -  counter-clockwise hook, wall-hugging, few turns
13.25      3      3       2  even-handed fly-past, few turns, open route
```

**Why rule-based rather than an LLM.** Deterministic, free, offline, instantly
localisable through the existing ICU catalogs (each trait is one message key),
and — decisively — **stable**: the name is a pure function of the group's own
geometry, so it does not drift as the player adds runs. An LLM pass over the
medoid rendered as ASCII (`gridToString` already exists) would produce more
charming names and could be layered on top as cached flavour text, but it should
not own the canonical name.

---

## 7. Holes

> Should a hole classify a maze as a completely different shape, or should the
> algorithm recognise it?

**Recognise it.** A leak is where behaviour space and configuration space
disagree hardest: the bricks say "coil", the route says something else entirely.

**Detection.** For each cell the route passes, hypothetically place one extra
block and re-solve; the largest resulting gain is the patch, and its size is the
cost of the leak. Cheap: 55k probe solves for a 342-maze session ran in **4
seconds**, and incrementally it is ~160 solves (≈12 ms) for a single new run.

**Measured on a 342-maze session** (15-brick budget):

- median maze: the best single extra block is worth **+1.98s (6%)** — most mazes
  are tight, with no hole
- **5.3%** of mazes have a single-block gain over 25% of their time
- those leaky mazes run a **median 17.1s against 32.4s** for the rest

So leaks are rare, and they are exactly the wasted attempts you described.

**Policy**, following from "a player won't reference a maze with a hole as a
source of improvement":

1. **Classify on intent, not outcome** — file a leaked maze by the route it
   _would_ have forced once patched. Tested: this moves **16 of 18** leaky mazes
   closer to their nearest brick-sibling (mean distance 0.375 → 0.288). A leaked
   coil stays filed under the coil.
2. **Never let a leak be a group's representative** — the representative is the
   best _clean_ maze, so reopening a group always lands on something worth
   improving.
3. **Never let a leak mint a group** — a mistake is not an idea.
4. **Surface it as a footnote, because it is genuinely interesting once**: _"6
   attempts here leaked — one block would have been worth up to +33.7s."_ That
   turns a wasted attempt into actionable feedback instead of hiding it.

---

## 8. What the data says

Recomputed all 11,169 non-void runs through the real engine; **every one
reproduced its stored time exactly**, so the analysis runs on ground truth.

**Sanity floor** (iteration 180): one-piece edits of one's own maze sit at mean
distance **0.061**; unrelated mazes at **0.312**. A 5× separation — the metric
tracks something real.

**Per-view ablation.** `separation` is how well a view alone tells
near-duplicates from unrelated mazes; `time-var` is how much of the variance in
run _time_ a clustering on that view alone explains.

| view         | separation | time-var  |
| ------------ | ---------- | --------- |
| word         | 0.81       | 4.9%      |
| turning      | 0.86       | 14.1%     |
| occupancy    | 0.74       | 2.0%      |
| brick        | 0.86       | 5.7%      |
| **pocket**   | 0.76       | **55.8%** |
| all combined | 0.80       | 63.3%     |

The split is the interesting part: `pocket` and `turning` carry **quality**
(they predict time), while `word`, `occupancy` and `brick` carry **identity**
(they separate mazes but say little about time). That is a feature, not a defect
— if every view predicted time, "shape groups" would just be leaderboard bands.
Inter-view correlations run 0.06–0.62, so no view is redundant; the highest pair
is occupancy↔brick (0.62), as expected since bricks determine where the route
goes.

**Held-out check.** Handedness is never shown to the clusterer. With the
signature partition switched off entirely, clustering on geometry alone recovers
it at **79.5%** against a 69.8% base rate — real but weak. That is evidence
_for_ the topological pre-partition: geometry alone does not reliably find the
distinction, so it has to be imposed.

**Whole-pipeline behaviour** across five iterations: 18–26 groups, largest group
20–51%, **81–93% of time variance explained**, and bootstrap stability (12
resamples at 80%) of **67–95%** of co-clustered pairs holding together.

**One structural finding worth recording.** I assumed a player's runs would form
an incremental edit trajectory and planned change-point detection over it. They
do not: consecutive runs differ by a **median of 10 of 15 pieces**, and
handedness flips 108 times across one 380-run session. Each 60-second attempt is
a fresh build, so a player's runs are near-independent samples from their
repertoire. That is _better_ for clustering — it is a cloud, not a trajectory —
and it means temporal segmentation would add nothing.

---

## 9. Productionising

**This can be entirely client-side.** The client already has the pathing engine
(`localRun` on the shared `cachedSolver`) and the Attempts panel already holds
the player's runs for the iteration. So: no new API method, no server compute,
no schema change. Grouping ~340 distinct mazes is well under a second; the leak
probe is the only real cost and is incremental per run.

Where things would live:

- `common/shape.ts` — descriptors and the distance function. Pure,
  framework-free, same rules as `common/pathing.ts`, and unit-testable against
  fixtures.
- `client/components/Game/` — the panel grouping, off the runs already loaded.
- `i18n/en.json` — one key per head phrase and per trait, so names localise
  through `t(...)` like everything else. Names are composed from a fixed
  vocabulary specifically so this works; note the glossary rule that user-facing
  piece names are **block** and **thunder**.

Two caveats to carry:

- **Storing the path would remove the recompute.** Runs store only pieces, so
  every descriptor starts by re-solving. That is fast, but if this becomes hot,
  a cached path per run is the obvious optimisation.
- **The dataset is 30 accounts, and 6 of them have ≥100 runs.** Everything above
  validates the _metric_ geometrically, which is what matters for a per-player
  feature. But any cross-player claim about the shape meta would be premature —
  3.1% of distinct mazes appear under more than one user id, which on 9-piece
  boards is essentially impossible by chance and suggests shared/test devices.

## 10. What I would check next

- Tune the five weights against a small hand-labelled set — a few dozen pairs
  marked "same approach / different approach" is enough to fit them properly,
  and would replace the current judgement calls with something defensible.
- Try the 2-view version (`word` + `pocket`) and see whether the extra three
  views earn their complexity on real sessions.
- Reuse the leak-probe machinery for leave-one-out brick importance, and test
  whether an importance-weighted brick mask beats the flat one.
