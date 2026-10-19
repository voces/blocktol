"""Calibrate the dendrogram cut height: what does "same shape" mean numerically?

A silhouette-optimal k is re-chosen per iteration, so "same shape" would mean
something different every day and groups could not be compared across days. A
fixed distance threshold is a stable definition -- but only if a single value
works across boards, which is what this sweeps for.
"""
import numpy as np, shapes as S, cluster as C

by = S.load()
print(f"{'iter':>5} {'thr':>5} {'grps':>5} {'big%':>6} {'sing':>5} {'sil':>6} {'timeR2':>7}")
for it in (180, 193, 153, 189, 152):
    runs = by[it]
    tr, Ds = S.views(runs)
    D = S.combine(Ds)
    times = np.array([r["time"] for r in runs])
    gm = times.mean(); sst = ((times - gm) ** 2).sum()
    sigs = [C.signature(t) for t in tr]
    for thr in (0.08, 0.12, 0.16, 0.20, 0.25):
        labels = np.full(len(runs), -1)
        nxt = 0
        for sig in sorted(set(sigs)):
            idx = [i for i, s in enumerate(sigs) if s == sig]
            if len(idx) < 3:
                for i in idx: labels[i] = nxt
                nxt += 1
                continue
            sub = D[np.ix_(idx, idx)]
            lb = S.cut(S.agglomerate(sub), len(idx), height=thr)
            for j, i in enumerate(idx): labels[i] = nxt + lb[j]
            nxt += lb.max() + 1
        sizes = np.bincount(labels)
        ssb = sum(s * (times[labels == c].mean() - gm) ** 2 for c, s in enumerate(sizes) if s)
        sil = S.silhouette(D, labels)
        print(f"{it:>5} {thr:>5.2f} {len(sizes):>5} {sizes.max()/len(runs):>6.1%} "
              f"{(sizes==1).sum():>5} {sil:>6.2f} {ssb/sst:>7.1%}")
    print()
