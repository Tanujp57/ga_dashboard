#!/usr/bin/env python3
"""Build data.js for the dashboard from the raw files in data/."""
import json, re, pandas as pd

def num(s):
    s = re.sub(r"[^\d.]", "", s or "")
    return float(s) if s else None

def party(p):
    p = p.lower()
    return "D" if p.startswith("democrat") else "R" if p.startswith("republican") else "O"

NAME_FIXES = {"Joseph R. Jr Biden": "Joe Biden", "Barack H. Obama": "Barack Obama", "Donald J. Trump": "Donald Trump",
              "Robert Dole": "Bob Dole", "M. Michelle Nunn": "Michelle Nunn", 'Michael "Mike" Thurmond': "Michael Thurmond",
              "David A. Perdue": "David Perdue", "Denise L. Majette": "Denise Majette"}

def nm(n):
    n = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), n.title())
    return NAME_FIXES.get(n, n)

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
        for label in (str(y), f"{y} Runoff"):
            c = wiki.get(kind + label)
            if not c: continue
            cands = [(x["c"], party(x["p"]), num(x["v"]), num(x["pc"])) for x in c]
            # percentages and the Dem-primary-only pages (no GOP candidate) are handled in row()
            r = row(label, y, cands)
            if r: out.append(r)
    return out

out = {"president": [], "governor": [], "senate": [], "county": {}}

# President
out["president"] += from_wiki("pres", range(1948, 1976, 4))
p = pd.read_csv("data/1976-2020-president.csv"); p = p[p.state_po == "GA"]
for y, g in p.groupby("year"):
    tot = g.totalvotes.iloc[0]
    cands = [(r.candidate.split(",")[0] if False else " ".join(reversed([s.strip() for s in r.candidate.split(",")])) if "," in r.candidate else r.candidate,
              {"DEMOCRAT": "D", "REPUBLICAN": "R"}.get(r.party, "O"), r.candidatevotes, 0) for r in g.itertuples()]
    out["president"].append(row(str(y), int(y), cands, tot))
out["president"].sort(key=lambda r: r["year"])

# Governor
out["governor"] = from_wiki("gov", range(1950, 2023, 4))
# 1966: Callaway (R) won a plurality, but no one reached 50% and the legislature elected Maddox (D).
# Write-in Ellis Arnall had run in the Democratic primary, so the Story view counts his votes as Democratic.
for r in out["governor"]:
    if r["year"] == 1966:
        arnall = next(num(x["pc"]) for x in wiki["gov1966"] if x["c"] == "Ellis Arnall")
        r.update(winner="Lester Maddox", wparty="D", writein=dict(name="Ellis Arnall", pct=arnall))

# Senate: Wikipedia before 2004 and after 2021, MEDSL in between
out["senate"] = from_wiki("sen", [*range(1950, 2004, 2), 2022])
s = pd.read_csv("data/1976-2020-senate.csv"); s = s[s.state_po == "GA"].copy()
# MEDSL files Georgia's 2008 general election as "pre" and the December runoff as "gen".
y08 = s.year == 2008
s.loc[y08, "stage"] = s.loc[y08, "stage"].map({"pre": "gen", "gen": "runoff"})
s = s[s.stage.isin(["gen", "runoff"])]
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

# Project-compiled statewide results (no candidate names): fills races missing above,
# replaces the county-summed 2024 row with official totals, and adds the national margin.
NAMES = {
    ("president", 1948): ("Harry S. Truman", "Thomas E. Dewey"),
    ("president", 1952): ("Adlai Stevenson", "Dwight D. Eisenhower"),
    ("president", 1956): ("Adlai Stevenson", "Dwight D. Eisenhower"),
    ("governor", 1950): ("Herman Talmadge", None), ("governor", 1954): ("Marvin Griffin", None),
    ("governor", 1958): ("Ernest Vandiver", None),
    ("senate", 1950): ("Walter F. George", None), ("senate", 1954): ("Richard Russell Jr.", None),
    ("senate", 1956): ("Herman Talmadge", None),
}
LABELS = {("senate", 2022): "2022 Runoff"}  # the file's 2022 Senate totals are the December runoff
OFFICES = {"President": ("president", "pres"), "Governor": ("governor", "gov"), "Senator": ("senate", "sen")}
pct = lambda s: float(s.rstrip("%")) if isinstance(s, str) else None
er = pd.read_csv("data/election_results.csv", thousands=",")
er = er[er.Total > 0]
natl, csv_unopposed = {}, {o: {} for o, _ in OFFICES.values()}
for _, e in er.iterrows():
    o, kind = OFFICES[e.Office]; y = int(e.Year); D, R = pct(e.Dem), pct(e.Rep)
    if o == "president":
        natl[y] = pct(e["National Democratic Margin"])
        if y == 2024:
            out[o][-1].update(D=D, R=R, O=round(100 - D - R, 2))
        if y < 1948:
            continue
    label = LABELS.get((o, y), str(y))
    if any(r["label"] == label for r in out[o]):
        continue
    w = wiki.get(f"{kind}{y}", [])
    dn = next((x["c"] for x in w if party(x["p"]) == "D"), None) or NAMES.get((o, y), (None, None))[0]
    rn = next((x["c"] for x in w if party(x["p"]) == "R"), None) or NAMES.get((o, y), (None, None))[1]
    if R == 0:
        csv_unopposed[o].setdefault(str(y), dict(label=str(y), year=y, status="unopposed", winner=dn, wparty="D"))
    else:
        out[o].append(row(label, y, [(dn, "D", None, D), (rn, "R", None, R), ("Other", "O", None, 100 - D - R)]))
for r in out["president"]:
    r["natl"] = natl.get(r["year"])
out["president"].sort(key=lambda r: r["year"])
out["governor"].sort(key=lambda r: r["year"])
out["senate"].sort(key=lambda r: (r["year"], "Special" in r["label"], "Runoff" in r["label"]))

# Story view: races that row() drops, either because no Republican ran
# ("unopposed") or because vote totals haven't been collected yet ("missing").
out["extra"] = {}
for office, kind in OFFICES.values():
    have = {r["label"] for r in out[office]}
    extra = {}
    for key, c in sorted(wiki.items()):
        label = key[len(kind):]
        if not key.startswith(kind) or label in have:
            continue
        y = int(label[:4])
        cands = [(x["c"], party(x["p"]), num(x["pc"])) for x in c]
        if any(p == "R" for _, p, _ in cands) or any(pc is None for *_, pc in cands):
            extra[label] = dict(label=label, year=y, status="missing", cands=[f"{n} ({p})" for n, p, _ in cands])
        else:
            win = max(cands, key=lambda x: x[2])
            extra[label] = dict(label=label, year=y, status="unopposed", winner=win[0], wparty=win[1])
    for label, r in csv_unopposed[office].items():
        extra.setdefault(label, r)
    out["extra"][office] = sorted(extra.values(), key=lambda r: r["label"])

# Demographics (Census Bureau population estimates): snapshots 2000, 2010, 2019
def demo(path, year_code):
    d = pd.read_csv(path, encoding="latin1")
    d = d[d.YEAR == year_code]
    tot = d[d.AGEGRP == 99] if (d.AGEGRP == 99).any() else d[d.AGEGRP == 0]
    res = {}
    for fip, g in d.groupby("COUNTY"):
        t = g[g.AGEGRP.isin([99, 0])].sort_values("AGEGRP", ascending=False).iloc[0] if (g.AGEGRP == 99).any() else g[g.AGEGRP == 0].iloc[0]
        pop = t.TOT_POP
        two = lambda col: t[col + "_MALE"] + t[col + "_FEMALE"]
        old = g[g.AGEGRP >= 14]
        old = old[old.AGEGRP != 99].TOT_POP.sum()
        res["13%03d" % fip] = [int(pop), round(100 * two("NHWA") / pop, 1), round(100 * two("NHBA") / pop, 1),
                               round(100 * two("H") / pop, 1), round(100 * two("NHAA") / pop, 1), round(100 * old / pop, 1)]
    return res
out["demo"] = {2000: demo("data/census_2000s_ga.csv", 3), 2010: demo("data/census_2010s_ga.csv", 3), 2019: demo("data/census_2010s_ga.csv", 12)}

json.dump(out, open("data.json", "w"))
open("data.js", "w").write("window.GA=" + json.dumps(out, separators=(",", ":")) + ";")
for k in ("president", "governor", "senate"):
    print(k, len(out[k]), [r["label"] for r in out[k]])
print("extra", {k: [(r["label"], r["status"]) for r in v] for k, v in out["extra"].items()})
print({y: len(v) for y, v in out["county"].items()})
print({y: len(v) for y, v in out["demo"].items()}, out["demo"][2019]["13121"])
