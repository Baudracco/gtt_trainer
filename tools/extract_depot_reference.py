#!/usr/bin/env python3
"""Extract DAPER's two physical columns without merging USCITA and RIENTRO.

The result is reference text, never route geometry. Page numbers and a source
checksum make every record traceable. The original PDF is not redistributed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import statistics

import pdfplumber


def extract(path):
    records = []
    prior_bounds = None
    with pdfplumber.open(path) as document:
        for number, page in enumerate(document.pages[1:], 2):
            tables = page.find_tables()
            if not tables:
                # Borderless continuation pages 47, 54 and 58 contain no new line label.
                if not prior_bounds or number not in (47, 54, 58):
                    raise ValueError(f"No table found on page {number}; manual review required")
                x_left, x_right, x_end = prior_bounds
                for key, a, b in [('uscita',x_left,x_right), ('rientro',x_right,x_end)]:
                    records[-1][key] += '\n' + (page.crop((a,103,b,790)).extract_text() or '').strip()
                records[-1]['pages'].append(number)
                continue
            for table in tables:
                left = [c for c in table.cells if c[2] - c[0] > 140 and c[0] < 300]
                right = [c for c in table.cells if c[2] - c[0] > 140 and c[0] >= 300]
                if not left or not right:
                    raise ValueError(f"Unrecognized columns on page {number}")
                x_left = statistics.median(c[0] for c in left)
                x_right = statistics.median(c[0] for c in right)
                x0, top, x1, bottom = table.bbox
                prior_bounds = (x_left,x_right,x1)
                label = (page.crop((x0, top, x_left, bottom)).extract_text() or "").replace("\n", " ").strip()
                uscita = (page.crop((x_left, top, x_right, bottom)).extract_text() or "").strip()
                rientro = (page.crop((x_right, top, x1, bottom)).extract_text() or "").strip()
                if label == "Linea" or uscita == "USCITA":
                    continue
                if not label:
                    if not records:
                        raise ValueError("Continuation without a preceding line")
                    record = records[-1]
                    record["uscita"] += "\n" + uscita
                    record["rientro"] += "\n" + rientro
                    if number not in record["pages"]:
                        record["pages"].append(number)
                else:
                    records.append({"id": f"daper-05-26-p{number}-{len(records)+1}", "line": label,
                                    "pages": [number], "uscita": uscita, "rientro": rientro})
    return {"title": "DAPER linee urbane e suburbane", "version": "05/26", "effectiveFrom": "2026-09-11",
            "source": Path(path).name, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            "geometryStatus": "not_georeferenced", "references": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(data['references'])} references; source pages 2–68; no geometry inferred")
