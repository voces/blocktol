"""Per-iteration, per-player approach listing.

Group count adapts to session size: cut the dendrogram at the "same approach"
height, then cap the result at TARGET_GROUPS. A player with 11 mazes gets
however many distinct approaches they actually tried; a player with 342 gets
the top-level 8. Forcing a fixed 8 on a small session would mint a group per
maze and call noise a taxonomy.
"""

import json
import os
import sys
from collections import Counter

import numpy as np

import shapes as S
import cluster as C
import attempts as A


def load_names(path="../users.jsonl"):
    """id -> display name.

    Two things the export does not guarantee, both handled rather than assumed:
    a user may have no name (8 of 39 here), and two users may share one (7 do).
    An unnamed user falls back to their id prefix; a shared name is suffixed
    with that prefix, so a row always identifies exactly one person -- these are
    per-player panels, and two players merged under one label would be wrong in
    a way that is hard to notice.
    """
    if not os.path.exists(path):
        return {}
    users = [json.loads(l) for l in open(path) if l.strip()]
    dupes = {n for n, c in Counter(
        u["name"] for u in users if u.get("name")).items() if c > 1}
    out = {}
    for u in users:
        n = u.get("name")
        out[u["id"]] = (
            f"{n} ({u['id'][:8]})" if n in dupes else n
        ) if n else u["id"][:8]
    return out


# Mazes needed before a cluster earns a name and a row of its own.
MIN_GROUP = 2


def session_groups(runs, leaks, min_time):
    rows = A.collapse(runs)
    for r in rows:
        key = tuple(sorted(map(tuple, r["pieces"])))
        info = leaks.get(key)
        r["leaked"] = bool(info and info["leaked"])
        r["leak_gain"] = info["gain"] if r["leaked"] else 0.0
        if r["leaked"]:
            r["path"] = info["path"]

    # Floored mazes are held out BEFORE the distance matrix is built, not after.
    # Leaving them in costs twice: they consume the group budget (five of one
    # session's eight rows went to 19 runs of flails while three real groups
    # held 410), and they distort the dendrogram they are about to be cut from.
    #
    # They are never DROPPED -- every run still appears, and the counts
    # reconcile -- and never MERGED into a real approach, because a 4-second
    # flail is not a weak version of a 33-second coil; it is a different route
    # entirely (usually a fly-past with no pocket at all). Folding it into the
    # nearest group would corrupt that group's run count and its exemplar.
    # They stay UNGROUPED -- listed individually, with no approach name, below
    # the named groups. That is exactly what the panel does with every maze
    # today, so an attempt that does not earn a name is no worse off than the
    # status quo, and it saves inventing a "bucket" concept the UI does not
    # otherwise have.
    keep, floored, floor = A.split_floor(rows, min_time)
    sub = [rows[i] for i in keep]

    tr_all = [None] * len(rows)
    tr_sub, Ds = S.views(sub)
    for j, i in enumerate(keep):
        tr_all[i] = tr_sub[j]
    D = S.combine(Ds)
    sigs_sub = np.array([C.signature(t) for t in tr_sub])
    D = D + A.SIG_PENALTY * (sigs_sub[:, None] != sigs_sub[None, :])
    np.fill_diagonal(D, 0.0)

    merges = S.agglomerate(D)
    natural = S.cut(merges, len(sub), height=A.SAME_APPROACH)
    k = min(A.TARGET_GROUPS, len(set(natural.tolist())))
    labels_sub = S.cut(merges, len(sub), k=k)
    sigs = np.array([""] * len(rows), dtype=object)
    for j, i in enumerate(keep):
        sigs[i] = sigs_sub[j]

    groups = []
    for c in sorted(set(labels_sub.tolist())):
        idx = [keep[j] for j in range(len(sub)) if labels_sub[j] == c]
        clean = [i for i in idx if not rows[i]["leaked"]] or idx
        bi = max(clean, key=lambda i: rows[i]["time"])
        groups.append({
            "sig": sigs[bi], "idx": idx, "best": bi,
            "best_time": rows[bi]["time"],
            "runs": sum(rows[i]["attempts"] for i in idx),
            "mazes": len(idx),
            "leaked": sum(1 for i in idx if rows[i]["leaked"]),
        })
    # A group of one is not an approach, it is a straggler that happened to sit
    # by itself -- the same judgement the floor makes about weak attempts, applied
    # to lonely ones. HDBSCAN calls these noise; here they join the ungrouped tail,
    # where the panel shows them exactly as it shows every maze today. Naming them
    # would spend a row asserting a pattern that a single maze cannot evidence.
    singles = [g for g in groups if len(g["idx"]) < MIN_GROUP]
    groups = [g for g in groups if len(g["idx"]) >= MIN_GROUP]
    for g in singles:
        floored.extend(g["idx"])

    groups.sort(key=lambda g: -g["best_time"])

    for g, nm in zip(groups, C.name_groups(groups, tr_all)):
        g["name"] = nm
    # Describe the ungrouped mazes as well. Withholding a name here conflated two
    # different claims: a GROUP name asserts "these N mazes share an approach"
    # and needs N >= 2 to be evidence of anything, whereas a lone maze's name is
    # just a description of that maze, which is always well defined. So the
    # threshold governs whether something is an APPROACH, not whether it can be
    # described -- a player reading "even-handed fly-past, few turns" knows
    # instantly it was a flail, where a bare 7.54 tells them nothing.
    #
    # Stragglers are left unnamed and stay out of the `taken` set entirely.
    # They are not approaches, so they have no name to be unique against -- and
    # letting them compete for names made the groups pay for it, since a group
    # colliding with a one-off flail had to grow a phrase to escape it. The
    # expansion budget belongs to the rows that are actually being told apart.
    return rows, groups, floored, floor


if __name__ == "__main__":
    by = S.load()
    NAMES = load_names()
    DATES = {125: "2026-06-16 (June 16th)", 186: "2026-07-24 (July 24th)"}
    only = [int(a) for a in sys.argv[1:]]
    for it in (only or [125, 186]):
        runs_all = by[it]
        players = sorted(
            {r["user"] for r in runs_all},
            key=lambda u: -max(r["time"] for r in runs_all if r["user"] == u),
        )
        meta = runs_all[0]
        print(f"\n{'#'*96}")
        print(f"# ITERATION {it} — {DATES[it]}   "
              f"{meta['bricks']} blocks, {meta['power']} thunder, min {meta['min']}s")
        print(f"# {len(runs_all)} runs across {len(players)} players")
        print(f"{'#'*96}")
        for u in players:
            runs = [r for r in runs_all if r["user"] == u]
            leaks = A.load_leaks(u[:8], it)
            rows, groups, floored, floor = session_groups(runs, leaks, meta["min"])
            best = max(r["time"] for r in runs)
            print(f"\n  {NAMES.get(u, u[:8])}   best {best:.2f}s   "
                  f"{len(runs)} runs  ->  "
                  f"{len(groups)} approaches"
                  + (f" + {len(floored)} ungrouped" if floored else ""))
            print(f"    {'best':>7} {'runs':>5}  approach")
            print(f"    {'-'*7} {'-'*5}  {'-'*68}")
            for g in groups:
                print(f"    {g['best_time']:>7.2f} {g['runs']:>5}  {g['name']}")
            if floored:
                print(f"    {'-'*7} {'-'*5}  ungrouped")
                for i in sorted(floored, key=lambda i: -rows[i]["time"]):
                    print(f"    {rows[i]['time']:>7.2f} {rows[i]['attempts']:>5}  —")
