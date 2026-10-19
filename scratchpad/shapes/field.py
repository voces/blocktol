"""The production-shaped question: group ONE DAY'S FIELD by approach.

Not every stored run -- one run per player (their best). That is the set a
leaderboard shows, and it removes the grinding artefact where one player's 200
near-identical free-play repeats dominate every distance statistic.
"""
import sys
import numpy as np, shapes as S, cluster as C

by = S.load()
for it in [int(a) for a in sys.argv[1:]] or [180]:
    allruns = by[it]
    best = {}
    for r in allruns:
        if r["user"] not in best or r["time"] > best[r["user"]]["time"]:
            best[r["user"]] = r
    runs = sorted(best.values(), key=lambda r: -r["time"])
    if len(runs) < 3:
        continue
    tr, D, Ds, clusters = C.group(runs, min_partition=2)
    print(f"\n{'='*92}")
    print(f"ITERATION {it} -- field of {len(runs)} players' best runs "
          f"(from {len(allruns)} stored runs)")
    print(f"{'='*92}")
    taken = set()
    for ci, c in enumerate(clusters):
        idx = c["idx"]
        times = np.array([runs[i]["time"] for i in idx])
        nm = C.name_cluster(c, tr, list(range(len(runs))), taken)
        tag = "  [one-off]" if c.get("oneoff") else ""
        print(f"\n{'-'*92}\n{nm}{tag}   n={len(idx)}   "
              f"times {times.min():.2f}-{times.max():.2f}")
        m = S.medoid(D, np.array(idx))
        print(f"  exemplar: {runs[m]['time']}s   turn word {tr[m]['word'][:60]}")
        for line in C.render(runs[m]):
            print("  " + line)
    ok, mean = C.stability(runs, D, tr)
    print(f"\n  bootstrap stability: {ok:.0%} of co-clustered pairs stay "
          f"together in >=80% of 80% subsamples (mean co-association {mean:.2f})")
