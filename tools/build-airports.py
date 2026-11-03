#!/usr/bin/env python3
"""Adds time zones and runway headings to data/airports.js.
Usage: python3 tools/build-airports.py <dir with OurAirports airports.csv + runways.csv> <base airports list js>
Runway data: OurAirports (public domain). Headings are the two ends of the 3 longest hard-surface runways."""
import csv, json, math, os, re, sys
src, base = sys.argv[1], sys.argv[2]
out = os.path.join(os.path.dirname(__file__), "..", "data", "airports.js")
rows = json.loads(re.search(r"window\.AIRPORTS = (\[.*\]);", open(base).read(), re.S).group(1))
TZ = {"IN": "Asia/Kolkata", "NP": "Asia/Kathmandu", "LK": "Asia/Colombo", "BD": "Asia/Dhaka", "PK": "Asia/Karachi", "AF": "Asia/Kabul", "AE": "Asia/Dubai", "QA": "Asia/Qatar",
      "OM": "Asia/Muscat", "SA": "Asia/Riyadh", "TR": "Europe/Istanbul", "IR": "Asia/Tehran", "IL": "Asia/Jerusalem", "EG": "Africa/Cairo", "ET": "Africa/Addis_Ababa", "KE": "Africa/Nairobi",
      "ZA": "Africa/Johannesburg", "GB": "Europe/London", "FR": "Europe/Paris", "NL": "Europe/Amsterdam", "DE": "Europe/Berlin", "CH": "Europe/Zurich", "IT": "Europe/Rome", "ES": "Europe/Madrid",
      "GR": "Europe/Athens", "AT": "Europe/Vienna", "DK": "Europe/Copenhagen", "RU": "Europe/Moscow", "SG": "Asia/Singapore", "MY": "Asia/Kuala_Lumpur", "TH": "Asia/Bangkok", "HK": "Asia/Hong_Kong",
      "CN": "Asia/Shanghai", "KR": "Asia/Seoul", "JP": "Asia/Tokyo", "PH": "Asia/Manila", "NZ": "Pacific/Auckland", "MX": "America/Mexico_City", "BR": "America/Sao_Paulo", "AR": "America/Argentina/Buenos_Aires"}
TZ_CODE = {"JFK": "America/New_York", "EWR": "America/New_York", "BOS": "America/New_York", "IAD": "America/New_York", "ATL": "America/New_York", "ORD": "America/Chicago", "DFW": "America/Chicago",
           "DEN": "America/Denver", "LAX": "America/Los_Angeles", "SFO": "America/Los_Angeles", "SEA": "America/Los_Angeles", "YYZ": "America/Toronto", "YVR": "America/Vancouver",
           "CGK": "Asia/Jakarta", "DPS": "Asia/Makassar", "SYD": "Australia/Sydney", "MEL": "Australia/Melbourne"}
ap = {}
for r in csv.DictReader(open(os.path.join(src, "airports.csv"), encoding="utf-8")):
    if r["iata_code"] and r["type"] in ("large_airport", "medium_airport", "small_airport"): ap.setdefault(r["iata_code"], r)
HARD = re.compile(r"ASP|CON|BIT|TAR|PEM|PAV|MAC|COM", re.I)
rw = {}
for r in csv.DictReader(open(os.path.join(src, "runways.csv"), encoding="utf-8")):
    if r["closed"] == "1" or not r["length_ft"] or int(float(r["length_ft"])) < 5000 or not HARD.search(r["surface"] or ""): continue
    hs = []
    for end in ("le", "he"):
        h = r[end + "_heading_degT"]
        if h == "":
            m = re.match(r"(\d+)", r[end + "_ident"] or "")
            h = int(m.group(1)) * 10 if m else None
        hs.append(None if h is None else round(float(h)) % 360)
    if None in hs: continue
    rw.setdefault(r["airport_ident"], []).append((int(float(r["length_ft"])), hs))
res = []; miss = []
for code, name, city, lat, lon in rows:
    a = ap.get(code); ident = a["ident"] if a else None
    tz = TZ_CODE.get(code) or TZ.get(a["iso_country"] if a else "")
    runs = sorted(rw.get(ident, []), reverse=True)[:3]
    heads = []
    for _, hs in runs:
        for h in hs:
            if h not in heads: heads.append(h)
    if not tz or not heads: miss.append((code, tz, heads))
    res.append([code, name, city, lat, lon, tz or "UTC", heads])
with open(out, "w") as fh:
    fh.write("// Bundled airport list: [IATA, name, city, lat, lon, IANA time zone, runway headings (deg true, both ends of the 3 longest runways)].\n")
    fh.write("// Time zones are hand-assigned; runways come from OurAirports (public domain) via tools/build-airports.py. Add rows freely; a row with no runways falls back to the direct route.\n")
    fh.write("window.AIRPORTS = [\n" + ",\n".join("  " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in res) + "\n];\n")
print(len(res), "airports; missing:", miss)
