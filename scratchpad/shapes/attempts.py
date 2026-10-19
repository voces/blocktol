"""The real target: collapse ONE player's runs on ONE iteration into a short
list of approaches, each with the best run they achieved with it.

A player with 380 attempts does not want 380 rows of {time, timestamp}. They
want "here are the 7 different things you tried, here is your best with each,
here is the one you should go back and push further". So the output is:

  - a handful of groups, ordered by the player's best time in each
  - one representative run per group -- the player's BEST in that group, not
    the group's medoid: the point is to resume from it, and nobody wants to
    resume from the most average version of an idea
  - a name that says what the approach IS, so two groups are told apart at a
    glance rather than by opening both

Runs that built the identical maze are collapsed first (the Attempts panel
already merges those into one row), so the clustering sees distinct mazes.
"""

import sys
from collections import defaultdict

import numpy as np

import shapes as S
import cluster as C

# How many rows the panel aims for. A fixed DISTANCE threshold is the right
# definition when groups must be comparable across days; here nothing is
# compared across anything -- this is one player's own board -- so the honest
# control is the one the reader actually cares about: how many rows they get.
# Cutting a dendrogram to a target count also hands the UI a coarser/finer
# control for free, which is the main reason to prefer hierarchical clustering
# over HDBSCAN for this screen.
TARGET_GROUPS = 8

# The distance below which two of one player's mazes are "the same approach".
# Used as the NATURAL granularity: cut here first to see how many distinct
# things a session actually contains, then cap the display at TARGET_GROUPS.
# That way a small session reports what it has instead of being padded out to
# eight groups of one, which would call noise a taxonomy.
SAME_APPROACH = 0.13

# Added to the distance between two runs whose topological signature differs.
# Large enough that agglomeration exhausts every within-signature merge first,
# so a clockwise and a counter-clockwise route only ever land together when the
# panel is cut coarser than the number of signatures present -- a soft version
# of the hard partition, which is what lets one global dendrogram control the
# group count.
SIG_PENALTY = 1.0


def collapse(runs):
    """One row per distinct maze; keep the best run and the attempt count."""
    by_maze = defaultdict(list)
    for r in runs:
        by_maze[tuple(sorted(map(tuple, r["pieces"])))].append(r)
    rows = []
    for _maze, group in by_maze.items():
        best = max(group, key=lambda r: r["time"])
        row = dict(best)
        row["attempts"] = len(group)
        row["first_tried"] = min(g["created"] for g in group)
        rows.append(row)
    return rows


# A maze is "leaked" when one extra block, placed anywhere the route passes,
# would have been worth more than this share of its time -- i.e. the runner is
# squirting through a hole the player did not mean to leave. Measured on a
# 342-maze session: 5% of mazes clear this bar, and they run a median 17.1s
# against 32.4s for the rest. They are wasted attempts, not ideas.
LEAK_REL = 0.25

# Attempts scoring below this far up from the board's unobstructed time toward
# the player's own best are floored out of the taxonomy: they are flails, not
# ideas, and naming them costs a panel row each.
#
# Anchored at BOTH ends -- `min` (what the runner does with nothing in its way)
# and the player's best -- rather than at a bare fraction of the best, which is
# the same shape as the game's own `standing(time, min, best)` and adapts to a
# board where even good play only doubles the base time.
FLOOR_FRAC = 0.4


def intent_time(row):
    """The time a maze was worth as an idea, not as an outcome.

    For a leaked maze that is its patched time. Flooring on realised time
    instead would throw out good ideas that happened to leak -- measured across
    five sessions, 42 mazes sit below the floor as built but above it once
    patched, one of them scoring 13.7s where its intent was 28.1s. Those are
    precisely the runs the leak handling exists to keep with their siblings.
    """
    return row["time"] + row.get("leak_gain", 0.0) if row.get("leaked") else row["time"]


def split_floor(rows, min_time, frac=FLOOR_FRAC):
    """Partition mazes into (kept, floored). Floored mazes are never dropped
    and never merged into a real approach -- see the note in report.py."""
    best = max((intent_time(r) for r in rows), default=0.0)
    floor = min_time + frac * (best - min_time)
    kept = [i for i, r in enumerate(rows) if intent_time(r) >= floor]
    floored = [i for i, r in enumerate(rows) if intent_time(r) < floor]
    # Never floor everything: a session where nothing cleared the bar still
    # deserves its taxonomy, however weak.
    if not kept:
        return list(range(len(rows))), [], floor
    return kept, floored, floor


def load_leaks(user_prefix, iteration):
    """Optional leak table from probeLeaks.ts, keyed by sorted piece tuple."""
    import json
    import os
    p = f"leaks-{user_prefix}-{iteration}.jsonl"
    if not os.path.exists(p):
        return {}
    out = {}
    for line in open(p):
        rec = json.loads(line)
        key = tuple(sorted(map(tuple, rec["pieces"])))
        rel = rec["patch_gain"] / rec["time"] if rec["time"] else 0
        out[key] = {
            "leaked": rel > LEAK_REL,
            "patch": rec["patch"],
            "gain": rec["patch_gain"],
            # Classify a leaked maze on the route it WOULD have forced once
            # patched: that is the shape the player was building, and it is
            # where they will look for it. Filing it under the route the hole
            # actually produced buries a coil under some shape they never had
            # in mind -- and mints an "approach" out of a mistake.
            "path": np.asarray(rec["patched_path"], float),
        }
    return out


def approaches(runs, target=TARGET_GROUPS, leaks=None):
    rows = collapse(runs)
    leaks = leaks or {}
    for r in rows:
        key = tuple(sorted(map(tuple, r["pieces"])))
        info = leaks.get(key)
        r["leaked"] = bool(info and info["leaked"])
        r["leak_patch"] = info["patch"] if r["leaked"] else None
        r["leak_gain"] = info["gain"] if r["leaked"] else 0.0
        if r["leaked"]:
            r["path"] = info["path"]

    tr, Ds = S.views(rows)
    D = S.combine(Ds)

    sigs = np.array([C.signature(t) for t in tr])
    D = D + SIG_PENALTY * (sigs[:, None] != sigs[None, :])
    np.fill_diagonal(D, 0.0)

    merges = S.agglomerate(D)
    labels = S.cut(merges, len(rows), k=min(target, len(rows)))

    out = []
    for c in sorted(set(labels.tolist())):
        idx = [i for i in range(len(rows)) if labels[i] == c]
        # The representative is the best CLEAN maze. A leaked maze is never
        # what a player wants to reopen -- they came here for a reference to
        # improve on, and a maze with a hole in it is not one. Fall back to the
        # leaked best only if the whole group leaked.
        clean = [i for i in idx if not rows[i]["leaked"]] or idx
        bi = max(clean, key=lambda i: rows[i]["time"])
        leaked = [i for i in idx if rows[i]["leaked"]]
        out.append({
            # A cut coarser than the signature count can span signatures; name
            # from the one the group's own best run has.
            "sig": sigs[bi],
            "idx": idx,
            "best": bi,
            "best_time": rows[bi]["time"],
            "mazes": len(idx),
            "attempts": sum(rows[i]["attempts"] for i in idx),
            "leaked": leaked,
            "leak_cost": max((rows[i]["leak_gain"] for i in leaked), default=0.0),
            "medoid": S.medoid(D, np.array(idx)),
        })
    out.sort(key=lambda g: -g["best_time"])
    return rows, tr, D, Ds, out


def panel(user, iteration, runs, show=3, leaks=None):
    rows, tr, D, Ds, groups = approaches(runs, leaks=leaks)
    print(f"\n{'='*94}")
    print(f"player {user[:8]}  ·  iteration {iteration}  ·  "
          f"{len(runs)} attempts, {len(rows)} distinct mazes  ->  "
          f"{len(groups)} approaches")
    print(f"{'='*94}")
    taken = set()
    hdr = f"{'best':>7} {'mazes':>6} {'tries':>6} {'leaked':>7}  approach"
    print(hdr)
    print("-" * 94)
    for g in groups:
        g["name"] = C.name_cluster({"idx": g["idx"], "sig": g["sig"]},
                                   tr, list(range(len(rows))), taken,
                                   rep=g["best"])
        lk = f"{len(g['leaked'])}" if g["leaked"] else "-"
        print(f"{g['best_time']:>7.2f} {g['mazes']:>6} {g['attempts']:>6} {lk:>7}  {g['name']}")

    print(f"\ntop {show} approaches, showing the player's BEST maze in each:\n")
    for g in groups[:show]:
        b = rows[g["best"]]
        t = tr[g["best"]]
        print(f"  {g['name']}")
        print(f"    best {b['time']}s over {g['attempts']} attempts / "
              f"{g['mazes']} mazes   ·   {b['created']}")
        print(f"    turn word  {t['word'][:70]}")
        if g["leaked"]:
            print(f"    {len(g['leaked'])} attempt(s) here leaked -- one block "
                  f"would have been worth up to +{g['leak_cost']:.1f}s")
        for line in C.render(b):
            print("    " + line)
        print()
    return rows, D, groups


if __name__ == "__main__":
    by = S.load()
    if len(sys.argv) < 3:
        sys.exit("usage: attempts.py <user-prefix> <iteration>")
    targets = [(sys.argv[1], int(sys.argv[2]))]
    for user_prefix, it in targets:
        runs = [r for r in by[it] if r["user"].startswith(user_prefix)]
        panel(runs[0]["user"], it, runs, leaks=load_leaks(user_prefix, it))
