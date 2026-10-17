#!/usr/bin/env python3
"""Split physical DAPER columns into individual, traceable depot movements.

Bold movement headings are read from the original PDF layout, not guessed from
joined street names. Exact source text, page/bounding boxes and ordered road text
are retained. The output is an authoring catalogue, never invented GPS geometry.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import statistics
import tempfile

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DEPOT = re.compile(r'Dep(?:osito|\.{1,2})?\s*(?:S\.\s*Paolo|San\s*Paolo|Gerbido|Venaria|Nizza|Tortona|Novara|Dora|Manin)', re.I)


def street_sequence(text):
    """Split road separators outside parentheses, retaining literal compound street names."""
    text = ' '.join(text.split())
    parts, start, depth = [], 0, 0
    for index, char in enumerate(text):
        if char == '(': depth += 1
        elif char == ')': depth = max(0, depth-1)
        elif char in '-–—' and depth == 0:
            before, after = text[max(0,index-1):index], text[index+1:]
            separator = before.isspace() or after.startswith(' ') or bool(re.match(r'(?:V\.|C\.|P\.|Str\.|Viale\b|Corso\b)',after))
            if separator:
                if part := text[start:index].strip(' -–—'): parts.append(part)
                start = index+1
    if part := text[start:].strip(' -–—'): parts.append(part)
    return parts


def physical_lines(page, box, number):
    """Read text lines and boldness from one physical source column, with provenance."""
    result = []
    for line in page.crop(box).extract_text_lines(x_tolerance=3,y_tolerance=2,return_chars=True):
        chars = [c for c in line['chars'] if c['text'].strip()]
        if not chars: continue
        bold = sum('bold' in c['fontname'].lower() for c in chars) / len(chars) >= .9
        result.append({'text':line['text'].strip(),'bold':bold,'page':number,
                       'bbox':[round(line[k],2) for k in ['x0','top','x1','bottom']]})
    return result


def split_column(lines):
    """Start only a bold heading containing an explicit depot name; retain continuation lines."""
    movements, current, prefix = [], None, []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line['bold']:
            group = [line]; end = index+1
            while end < len(lines) and lines[end]['bold'] and lines[end]['page'] == line['page'] and lines[end]['bbox'][1]-group[-1]['bbox'][3] < 5:
                group.append(lines[end]);end += 1
            title = ' '.join(item['text'] for item in group)
            if DEPOT.search(title):
                if current: movements.append(current)
                current = {'title':title,'headingFragments':group,'bodyLines':[],'context':list(prefix)}
                prefix = []
                index = end;continue
        if current: current['bodyLines'].append(line)
        else: prefix.append(line['text'])
        index += 1
    if current: movements.append(current)
    elif prefix: return [], '\n'.join(prefix)
    return movements, None


def endpoints(title, which):
    """Separate the literal depot endpoint and destination without translating operational direction."""
    matches = list(DEPOT.finditer(title))
    if not matches: return '', '', ''
    chosen = matches[0] if which == 'uscita' else matches[-1]
    depot = chosen.group()
    if which == 'uscita': return depot, title[chosen.end():].lstrip(' -–—'), depot
    return title[:chosen.start()].rstrip(' -–—'), depot, depot


def depot_code(value):
    """Normalize spelling only for filtering, retaining the literal source endpoint."""
    value = re.sub(r'[.\s]+', ' ', value.lower())
    if 'paolo' in value: return 'san-paolo'
    for name in ['gerbido', 'venaria', 'nizza', 'tortona', 'novara', 'dora', 'manin']:
        if name in value: return name
    raise ValueError('Unrecognized explicit depot')


def extract(pdf_path, reference_path):
    """Use the original reference table boundaries and bold headings for all source pages."""
    reference = json.loads(reference_path.read_text())
    digest = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    if digest != reference['sha256']: raise ValueError('PDF does not match reference provenance')
    records, prior_bounds, active = [], None, None
    with pdfplumber.open(pdf_path) as pdf:
        for number, page in enumerate(pdf.pages[1:],2):
            tables = page.find_tables()
            if not tables:
                if not prior_bounds or number not in (47,54,58): raise ValueError(f'Unexpected borderless page {number}')
                left, right, end = prior_bounds
                for which, a, b in [('uscita',left,right),('rientro',right,end)]:
                    active[which].extend(physical_lines(page,(a,103,b,790),number))
                continue
            for table in tables:
                l = [c for c in table.cells if c[2]-c[0]>140 and c[0]<300]
                r = [c for c in table.cells if c[2]-c[0]>140 and c[0]>=300]
                if not l or not r: raise ValueError(f'Unrecognized table on page {number}')
                left, right = statistics.median(c[0] for c in l), statistics.median(c[0] for c in r)
                x0, top, end, bottom = table.bbox
                prior_bounds = left, right, end
                label = (page.crop((x0,top,left,bottom)).extract_text() or '').replace('\n',' ').strip()
                plain = (page.crop((left,top,right,bottom)).extract_text() or '').strip()
                if label == 'Linea' or plain == 'USCITA': continue
                if label:
                    source = reference['references'][len(records)]
                    if source['line'] != label: raise ValueError(f'Reference alignment differs on page {number}')
                    active = {'source':source,'uscita':[],'rientro':[]};records.append(active)
                if active is None: raise ValueError('Continuation without reference')
                for which, a, b in [('uscita',left,right),('rientro',right,end)]:
                    active[which].extend(physical_lines(page,(a,top,b,bottom),number))
    if len(records) != len(reference['references']): raise ValueError('Reference count differs')
    movements, unresolved = [], []
    for record in records:
        source = record['source']
        for which in ['uscita','rientro']:
            groups, unparsed = split_column(record[which])
            if unparsed: unresolved.append({'sourceRefId':source['id'],'column':which,'text':unparsed,'pages':source['pages']})
            for sequence, group in enumerate(groups,1):
                body = '\n'.join(line['text'] for line in group['bodyLines']).strip()
                origin, destination, depot = endpoints(group['title'],which)
                fragments = group['headingFragments']+group['bodyLines']
                streets = street_sequence(body)
                ident = f"{source['id']}-{which}-{sequence}"
                flags = ['geometry_required','operational_review_required']
                if not body: flags.append('empty_source_body')
                if re.search(r'\b(oppure|alternativ|viceversa|deviazion|esclus)',body,re.I):flags.append('source_condition_or_alternative')
                movements.append({'id':ident,'sourceRefId':source['id'],'lineLabel':source['line'],
                    'movement':which,'kind':'depot_out' if which=='uscita' else 'depot_in','direction':'none',
                    'title':group['title'],'origin':origin,'destination':destination,'depot':depot,'depotCode':depot_code(depot),
                    'pages':sorted({line['page'] for line in fragments}), 'streetSequence':streets,
                    'sourceText':body,'sourceContext':group['context'],
                    'sourceFragments':[{'page':line['page'],'bbox':line['bbox']} for line in fragments],
                    'sourceTextSha256':hashlib.sha256((group['title']+'\n'+body).encode()).hexdigest(),
                    'geometryStatus':'not_georeferenced','reviewFlags':flags})
    return {'schemaVersion':1,'title':reference['title'],'version':reference['version'],
            'effectiveFrom':reference['effectiveFrom'],'sourceSha256':digest,
            'sourceReferenceCount':len(records),'movements':movements,'unresolvedColumns':unresolved}


def atomic_bytes(path, raw):
    """Publish a complete private file using a same-directory fsynced atomic replacement."""
    path.parent.mkdir(parents=True,exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.import-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            os.fchmod(stream.fileno(),0o644);stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def require_private_output(directory):
    """Permit runtime storage or an external private directory, never repository/public data paths."""
    resolved=directory.resolve();allowed=ROOT/'server/var'
    if resolved==ROOT or (ROOT in resolved.parents and resolved!=allowed and allowed not in resolved.parents):
        raise ValueError('Operational references require private runtime storage')


def write_catalogue(output, data):
    """Write small content-addressed parts and an index; the original PDF is never copied."""
    require_private_output(output.parent)
    output.parent.mkdir(parents=True, exist_ok=True)
    folder = output.parent/'parts'
    folder.mkdir(exist_ok=True)
    parts = []
    for start in range(0, len(data['movements']), 32):
        records = data['movements'][start:start+32]
        raw = (json.dumps(records, ensure_ascii=False, separators=(',', ':'))+'\n').encode()
        digest = hashlib.sha256(raw).hexdigest()
        name = digest + '.json'
        if not (folder/name).exists() or (folder/name).read_bytes()!=raw:atomic_bytes(folder/name,raw)
        parts.append({'file':name,'sha256':digest,'count':len(records),'movementIds':[m['id'] for m in records]})
    index = {key:value for key,value in data.items() if key != 'movements'}
    index.update(available=True,movementCount=len(data['movements']),parts=parts)
    atomic_bytes(output,(json.dumps(index,ensure_ascii=False,indent=2)+'\n').encode())


def main():
    """Extract movements without making network requests or generating geometries."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf',type=Path)
    parser.add_argument('--references',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'server/var/references/index.json')
    args=parser.parse_args();require_private_output(args.output.parent)
    data=extract(args.pdf,args.references)
    raw=args.references.read_bytes();digest=hashlib.sha256(raw).hexdigest()
    data['blocksSha256']=digest
    atomic_bytes(args.output.parent/'blocks'/f'{digest}.json',raw)
    write_catalogue(args.output,data)
    print(json.dumps({'movements':len(data['movements']),'unresolvedColumns':len(data['unresolvedColumns']),
                      'cp1':[m['title'] for m in data['movements'] if m['sourceRefId']=='daper-05-26-p2-1']},ensure_ascii=False))


if __name__=='__main__':main()
