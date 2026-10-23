#!/usr/bin/env python3
"""Build data.js for the dashboard from the raw files in data/."""
import json, re, pandas as pd

def num(s):
    s = re.sub(r"[^\d.]", "", s or "")
    return float(s) if s else None

def party(p):
    p = p.lower()
    return "D" if p.startswith("democrat") else "R" if p.startswith("republican") else "O"

def nm(n):
    return {"Joseph R. Jr Biden": "Joe Biden", "Barack H. Obama": "Barack Obama"}.get(n.title(), n.title())

def row(label, year, cands, total=None):
    """cands: list of (name, party letter, votes, pct)."""
    if total:
        cands = [(n, p, v, 100 * v / total) for n, p, v, _ in cands]
    d = [c for c in cands if c[1] == "D"]; r = [c for c in cands if c[1] == "R"]
    if not d or not r or any(c[3] is None for c in cands):
        return None
    d = max(d, key=lambda c: c[3]); r = max(r, key=lambda c: c[3])
    win = max(cands, key=lambda c: c[3])
    return dict(label=label, year=year, D=round(d[3], 2), R=round(r[3], 2),
                O=round(max(0, 100 - d[3] - r[3]), 2), dname=nm(d[0]), rname=nm(r[0]),
                winner=nm(win[0]), wparty=win[1])

wiki = json.load(open("data/wikipedia_ga.json"))
def from_wiki(kind, yrs):
    out = []
    for y in yrs:
        c = wiki.get(f"{kind}{y}")
        if not c: continue
        cands = [(x["c"], party(x["p"]), num(x["v"]), num(x["pc"])) for x in c]
        # percentages and the Dem-primary-only pages (no GOP candidate) are handled in row()
        r = row(str(y), y, cands)
        if r: out.append(r)
    return out

out = {"president": [], "governor": [], "senate": [], "county": {}}

# President
out["president"] += from_wiki("pres", range(1960, 1976, 4))
p = pd.read_csv("data/1976-2020-president.csv"); p = p[p.state_po == "GA"]
for y, g in p.groupby("year"):
    tot = g.totalvotes.iloc[0]
    cands = [(r.candidate.split(",")[0] if False else " ".join(reversed([s.strip() for s in r.candidate.split(",")])) if "," in r.candidate else r.candidate,
              {"DEMOCRAT": "D", "REPUBLICAN": "R"}.get(r.party, "O"), r.candidatevotes, 0) for r in g.itertuples()]
    out["president"].append(row(str(y), int(y), cands, tot))
out["president"].sort(key=lambda r: r["year"])

# Governor
out["governor"] = from_wiki("gov", range(1962, 2023, 4))

# Senate: Wikipedia before 2004, MEDSL afterwards
out["senate"] = from_wiki("sen", range(1960, 2004, 2))
s = pd.read_csv("data/1976-2020-senate.csv"); s = s[(s.state_po == "GA") & s.stage.isin(["gen", "runoff"])]
for (y, special, stage), g in s.groupby(["year", "special", "stage"]):
    tot = g.totalvotes.iloc[0]
    cands = [(str(r.candidate), {"DEMOCRAT": "D", "REPUBLICAN": "R"}.get(r.party_simplified, "O"), r.candidatevotes, 0) for r in g.itertuples()]
    # Sum parties (the 2020 special was a many-candidate jungle race)
    if len(g) > 4:
        agg = {}
        for n, pt, v, _ in cands:
            a = agg.setdefault(pt, [n, 0]); a[1] += v
            if v > 0 and v > [c for c in cands if c[0] == a[0]][0][2]: a[0] = n
        cands = [(a[0], pt, a[1], 0) for pt, a in agg.items()]
    label = f"{y}" + (" Special" if special else "") + (" Runoff" if stage == "runoff" else "")
    r = row(label, int(y), cands, tot)
    if r: out["senate"].append(r)
out["senate"].append(row("2022", 2022, [("Raphael Warnock", "D", 1946117, 49.44), ("Herschel Walker", "R", 1908442, 48.49)]))
out["senate"].sort(key=lambda r: (r["year"], "Special" in r["label"], "Runoff" in r["label"]))

# County results (presidential)
county = {}
for y, d in json.load(open("data/wikipedia_county_1960-2004.json")).items():
    county[int(y)] = {k: v[:3] for k, v in d.items()}
c = pd.read_csv("data/county_2008-2016.csv", dtype=str)
c = c[c.fips_code.str.zfill(5).str.startswith("13")]
for y in (2008, 2012):
    county[y] = {r.fips_code.zfill(5): [int(r[f"dem_{y}"]), int(r[f"gop_{y}"]), int(r[f"total_{y}"])] for _, r in c.iterrows()}
for y in (2016, 2020, 2024):
    c = pd.read_csv(f"data/county_{y}.csv", dtype=str)
    fcol = "county_fips" if "county_fips" in c else "combined_fips"
    c = c[c[fcol].str.zfill(5).str.startswith("13")]
    county[y] = {r[fcol].zfill(5): [int(float(r["votes_dem"])), int(float(r["votes_gop"])), int(float(r["total_votes"]))] for _, r in c.iterrows()}
out["county"] = {y: county[y] for y in sorted(county)}

# 2024 statewide row from county sums
d24 = sum(v[0] for v in county[2024].values()); r24 = sum(v[1] for v in county[2024].values()); t24 = sum(v[2] for v in county[2024].values())
out["president"].append(dict(label="2024", year=2024, D=round(100 * d24 / t24, 2), R=round(100 * r24 / t24, 2),
    O=round(100 * (t24 - d24 - r24) / t24, 2), dname="Kamala Harris", rname="Donald Trump",
    winner="Donald Trump" if r24 > d24 else "Kamala Harris", wparty="R" if r24 > d24 else "D"))

# Demographics (Census Bureau July-1 population estimates), only for election years the files cover
def demo(path, year_code, tot_code, old_from):
    d = pd.read_csv(path, encoding="latin1")
    d = d[d.YEAR == year_code]
    res = {}
    for fip, g in d.groupby("COUNTY"):
        t = g[g.AGEGRP == tot_code].iloc[0]
        pop = t.TOT_POP
        two = lambda col: t[col + "_MALE"] + t[col + "_FEMALE"]
        old = g[(g.AGEGRP >= old_from) & (g.AGEGRP != 99)].TOT_POP.sum()
        res["13%03d" % fip] = [int(pop), *(round(float(100 * two(c) / pop), 1) for c in ("NHWA", "NHBA", "H", "NHAA")), round(float(100 * old / pop), 1)]
    return res
out["demo"] = {}
for y, yc in ((2000, 2), (2004, 6), (2008, 10)):
    out["demo"][y] = demo("data/census_2000s_ga.csv", yc, 99, 13)
for y, yc in ((2012, 5), (2016, 9)):
    out["demo"][y] = demo("data/census_2010s_ga.csv", yc, 0, 14)

# National popular vote (for "Georgia vs. the nation"); 1976-2020 summed from MEDSL state rows, 2024 from county file,
# 1960-1972 from Wikipedia infoboxes (D, R, total votes)
nat = {1960: (34220984, 34108157, 68838219), 1964: (43129040, 27175754, 70639284),
       1968: (31271839, 31783783, 73199998), 1972: (29173222, 47168711, 77744027)}
for y, g in pd.read_csv("data/1976-2020-president.csv").groupby("year"):
    nat[int(y)] = (int(g[g.party == "DEMOCRAT"].candidatevotes.sum()), int(g[g.party == "REPUBLICAN"].candidatevotes.sum()),
                   int(g.drop_duplicates("state").totalvotes.sum()))
c24 = pd.read_csv("data/county_2024.csv")
nat[2024] = (int(c24.votes_dem.sum()), int(c24.votes_gop.sum()), int(c24.total_votes.sum()))
out["nation"] = {y: [round(100 * d / t, 2), round(100 * r / t, 2)] for y, (d, r, t) in sorted(nat.items())}

json.dump(out, open("data.json", "w"))
open("data.js", "w").write("window.GA=" + json.dumps(out, separators=(",", ":")) + ";")
for k in ("president", "governor", "senate"):
    print(k, len(out[k]), [r["label"] for r in out[k]])
print({y: len(v) for y, v in out["county"].items()})
print({y: len(v) for y, v in out["demo"].items()}, out["demo"][2008]["13121"], out["demo"][2016]["13121"])
