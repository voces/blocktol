"""Does classifying a leaky maze by its INTENT put it back with its siblings?

A leak is an accidental hole the runner squirts through. The realised route is
then nothing like the one the player was building, so path-based grouping files
the maze under a shape the player never had in mind -- and, worse, mints a new
"approach" out of a wasted attempt. The test: reclassify each leaky maze using
the path it WOULD have forced with its best single patch, and check whether it
lands nearer its own brick-siblings than the realised path did.
"""
import json
import sys
import numpy as np
import shapes as S
import cluster as C

# The output of probeLeaks.ts: leaks-<user-prefix>-<iteration>.jsonl
if len(sys.argv) < 2:
    sys.exit("usage: leaks.py <leaks-file.jsonl>")
L = [json.loads(l) for l in open(sys.argv[1])]
LEAK_REL = 0.25  # single-block gain worth >25% of the time = a real hole

meta = {"checkpoint": {"x": 15, "y": 5}, "min": 4.6, "bricks": 15, "power": 0,
        "base": [], "slows": []}


def as_run(rec, patched):
    r = dict(meta)
    r["pieces"] = rec["pieces"]
    r["time"] = rec["patched_time"] if patched else rec["time"]
    r["path"] = np.asarray(rec["patched_path" if patched else "path"], float)
    return r


leaky = [x for x in L if x["time"] > 0 and x["patch_gain"] / x["time"] > LEAK_REL]
clean = [x for x in L if x["time"] > 0 and x["patch_gain"] / x["time"] <= LEAK_REL]
print(f"{len(leaky)} leaky mazes, {len(clean)} clean")

# Distance from each leaky maze to the clean maze it most resembles IN BRICKS
# (its intent-sibling), measured two ways: with its realised route, and with
# its patched route.
clean_runs = [as_run(x, False) for x in clean]
Bc = np.stack([S.brick_mask(r["pieces"]) for r in clean_runs])

rows_real = [as_run(x, False) for x in leaky]
rows_pat = [as_run(x, True) for x in leaky]

_tc, Dc = S.views(clean_runs)
worse = better = 0
gaps_real, gaps_pat = [], []
for i, x in enumerate(leaky):
    bm = S.brick_mask(x["pieces"])
    sib = int(np.argmax(Bc @ bm))  # nearest clean maze in brick space
    pair_real = S.views([rows_real[i], clean_runs[sib]])[1]
    pair_pat = S.views([rows_pat[i], clean_runs[sib]])[1]
    dr = S.combine(pair_real)[0, 1]
    dp = S.combine(pair_pat)[0, 1]
    gaps_real.append(dr)
    gaps_pat.append(dp)
    if dp < dr:
        better += 1
    elif dp > dr:
        worse += 1

print(f"distance to nearest brick-sibling:")
print(f"  using the realised route  {np.mean(gaps_real):.3f}")
print(f"  using the patched route   {np.mean(gaps_pat):.3f}")
print(f"  moved closer {better}/{len(leaky)}, further {worse}/{len(leaky)}")
