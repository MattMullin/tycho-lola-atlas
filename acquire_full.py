"""Resume all released, valid LOLA RDR shots over the Tycho terrain region.

The ODE frame CSV preserves five detector fields; all-invalid frames are not
returned by ODE. Every completed spatial/year tile is published atomically.
Run: python acquire_full.py [--one] [--workers 3]
"""
import argparse
import bisect
import csv
import hashlib
import json
import math
import os
import struct
import subprocess
import threading
import time
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from pipeline import ROOT, OUT, RADIUS_M, index_products

FULL=OUT/'full'
SOURCE=FULL/'source'
CHUNKS=FULL/'chunks'
MANIFEST=FULL/'manifest.json'
LOG=FULL/'acquisition.log'
FAIL=FULL/'failures.jsonl'
BOUNDS=[346.8,-44.7,350.8,-41.8]
X_EDGES=[346.8,348.8,350.8]
Y_EDGES=[-44.7,-43.25,-41.8]
YEARS=range(2009,2027)
PAD=.03
MAX_BYTES=1_500_000_000
RECORD=struct.Struct('<fffIIHBB') # lon, lat, height m, UTC sec since 2009, us, local product, detector, flag
EPOCH=datetime(2009,1,1)
lock=threading.Lock()


def log(message):
    line=f'{datetime.now(timezone.utc).isoformat()} {message}'
    with lock:
        print(line,flush=True)
        LOG.parent.mkdir(parents=True,exist_ok=True)
        with LOG.open('a',encoding='utf8') as f:f.write(line+'\n')


def atomic_json(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(obj,separators=(',',':')),encoding='utf8')
    os.replace(tmp,path)


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def used_bytes():
    return sum(p.stat().st_size for p in FULL.rglob('*') if p.is_file() and not p.name.endswith('.part'))


def fetch(url,dest,estimate=None,timeout=240):
    """Cache verified downloads and resume .part files; never accept HTTP errors."""
    if dest.exists() and dest.stat().st_size>100:return
    dest.parent.mkdir(parents=True,exist_ok=True)
    with lock:
        if estimate and used_bytes()+estimate>MAX_BYTES:raise RuntimeError('1.5 GB Tycho acquisition budget reached')
    part=dest.with_name(dest.name+'.part')
    cmd=['curl.exe','-L','--retry','3','--retry-delay','2','--fail','--silent','--show-error','--max-time',str(timeout),'-C','-',url,'-o',str(part)]
    subprocess.run(cmd,check=True,timeout=timeout+20,capture_output=True)
    if part.stat().st_size<=100:raise RuntimeError(f'Truncated download: {url}')
    os.replace(part,dest)


def tile_id(year,ix,iy):return f'{year}_x{ix}_y{iy}'


def inside_tile(lon,lat,ix,iy):
    lon=lon%360
    return (X_EDGES[ix]<=lon<(X_EDGES[ix+1] if ix==0 else X_EDGES[ix+1]+1e-10)
            and Y_EDGES[iy]<=lat<(Y_EDGES[iy+1] if iy==0 else Y_EDGES[iy+1]+1e-10))


def query_url(year,ix,iy):
    params={'query':'lolardr','results':'f','westernlon':X_EDGES[ix]-PAD,
            'easternlon':X_EDGES[ix+1]+PAD,'minlat':Y_EDGES[iy]-PAD,
            'maxlat':Y_EDGES[iy+1]+PAD,'minobtime':f'{year}-01-01',
            'maxobtime':f'{year}-12-31','output':'JSON'}
    return 'https://oderest.rsl.wustl.edu/livegds/?'+urllib.parse.urlencode(params)


def query_files(year,ix,iy):
    ident=tile_id(year,ix,iy)
    response=SOURCE/f'{ident}_query.json'
    for attempt in range(2):
        if not response.exists():fetch(query_url(year,ix,iy),response,timeout=180)
        try:
            result=json.loads(response.read_text(encoding='utf8'))['GDSResults']
            if result.get('Status','').lower()!='success':raise RuntimeError(f'ODE status: {result}')
            count=int(result.get('Count',-1))
            if count<0:raise RuntimeError('ODE response lacks point count')
            if count==0:return count,None,None
            items=result['ResultFiles']['ResultFile']
            if isinstance(items,dict):items=[items]
            files={Path(urllib.parse.urlparse(v['URL']).path).suffix.lower():v for v in items}
            if '.csv' not in files or '.lbl' not in files:raise RuntimeError('ODE omitted CSV or label')
            paths=[]
            for ext in ('.csv','.lbl'):
                item=files[ext]
                dest=SOURCE/f'{ident}_frames{ext}'
                # SizeKB is an approximate ODE value, not an exact checksum.
                fetch(item['URL'],dest,int(float(item.get('SizeKB',0))*1024)+1024,timeout=240)
                paths.append(dest)
            return count,*paths
        except Exception:
            response.unlink(missing_ok=True) # expiring ODE output URLs get a fresh query
            if attempt:raise
    raise RuntimeError('Unreachable query retry')


def utc_fields(value):
    # ODE emits eight fractional digits; the display derivative keeps µs.
    dt=datetime.fromisoformat(value[:26])
    sec=int((dt.replace(microsecond=0)-EPOCH).total_seconds())
    return dt,sec,dt.microsecond


def process_tile(year,ix,iy,products,starts):
    ident=tile_id(year,ix,iy)
    meta_path=CHUNKS/f'{ident}.json'
    if meta_path.exists():
        cached=json.loads(meta_path.read_text(encoding='utf8'))
        binary=FULL/cached['binary'];rejected_file=FULL/cached['rejected']
        valid=(binary.exists() and binary.stat().st_size==cached['counts']['accepted']*RECORD.size
               and sha(binary)==cached['binary_sha256'] and rejected_file.exists()
               and sha(rejected_file)==cached['rejected_sha256'])
        if cached['source_csv']:
            source=FULL/cached['source_csv'];label=FULL/cached['source_label']
            source_ok=source.exists() and label.exists() and sha(source)==cached['source_csv_sha256']
            if source.exists() and not source_ok:source.unlink()
            valid=valid and source_ok
        if valid:return cached
        log(f'{ident}: cached tile failed verification; rebuilding')
        meta_path.unlink()
    reported,csv_path,label_path=query_files(year,ix,iy)
    counts=Counter();source_ids={};accepted=[];rejected=[];seen=set();dates=[]
    if csv_path:
        with csv_path.open(newline='',encoding='utf-8-sig') as f:
            reader=csv.DictReader(f)
            if not reader.fieldnames or 'Coordinated_Universal_Time' not in reader.fieldnames:raise RuntimeError('Unexpected CSV header')
            for raw in reader:
                frame={k.strip():v.strip() for k,v in raw.items() if k is not None}
                utc=frame['Coordinated_Universal_Time']
                dt,sec,us=utc_fields(utc)
                idx=bisect.bisect_right(starts,dt)-1
                product=products[idx] if idx>=0 and dt<=products[idx][1] else None
                if product is None:raise RuntimeError(f'Cannot resolve PDS source for {utc}')
                pid=product[2]
                counts['source_frames']+=1
                for detector in range(1,6):
                    try:
                        prefix=f'D{detector}_'
                        lon=float(frame[prefix+'Longitude'])%360
                        lat=float(frame[prefix+'Latitude'])
                        radius=float(frame[prefix+'Radius'])
                        flag=int(frame[f'Flg{detector}'])
                    except (ValueError,KeyError) as exc:
                        counts['parse_error']+=1;continue
                    if not (math.isfinite(lon) and math.isfinite(lat)) or not inside_tile(lon,lat,ix,iy):
                        counts['outside_point_tile']+=1;continue
                    counts['point_entries']+=1
                    key=(pid,sec,us,detector)
                    if key in seen:
                        counts['duplicate']+=1;continue
                    seen.add(key)
                    reason=[]
                    if not math.isfinite(radius) or radius<=0:reason.append('missing_radius')
                    if flag!=0:reason.append('shot_flag_nonzero')
                    if not reason:
                        local=source_ids.setdefault(pid,len(source_ids))
                        accepted.append((sec,us,lon,lat,radius*1000-RADIUS_M,local,detector,flag))
                        dates.append(utc)
                    else:
                        rejected.append({'utc':utc,'lon':lon,'lat':lat,'radius_km':radius,
                                         'flag':flag,'detector':detector,'frame':int(frame['Frame']),
                                         'mission_et':frame['Mission_ET'],'product_id':pid,'source_file':product[3],
                                         'reasons':reason})
                        for item in reason:counts[item]+=1
    accepted.sort(key=lambda p:(p[0],p[1],p[6]))
    counts['accepted']=len(accepted);counts['rejected']=len(rejected)
    if csv_path and counts['accepted']<=0 and reported>0:
        raise RuntimeError(f'{ident}: ODE reported {reported} points but no accepted records survived clip')
    binary=CHUNKS/f'{ident}.bin'
    temp=binary.with_name(binary.name+'.tmp')
    CHUNKS.mkdir(parents=True,exist_ok=True)
    with temp.open('wb') as f:
        for sec,us,lon,lat,height,local,detector,flag in accepted:
            f.write(RECORD.pack(lon,lat,height,sec,us,local,detector,flag))
    os.replace(temp,binary)
    reject_path=CHUNKS/f'{ident}_rejected.jsonl'
    temp=reject_path.with_name(reject_path.name+'.tmp')
    with temp.open('w',encoding='utf8') as f:
        for item in rejected:f.write(json.dumps(item,separators=(',',':'))+'\n')
    os.replace(temp,reject_path)
    local_products=[None]*len(source_ids)
    for pid,n in source_ids.items():local_products[n]=pid
    meta={'id':ident,'year':year,'tile':[ix,iy],'bounds':[X_EDGES[ix],Y_EDGES[iy],X_EDGES[ix+1],Y_EDGES[iy+1]],
          'query_pad_deg':PAD,'query_url':query_url(year,ix,iy),'ode_reported_valid_count':reported,
          'counts':dict(counts),'products':local_products,'first_utc':min(dates) if dates else None,
          'last_utc':max(dates) if dates else None,'binary':f'chunks/{ident}.bin',
          'binary_sha256':sha(binary),'source_csv':f'source/{ident}_frames.csv' if csv_path else None,
          'source_csv_sha256':sha(csv_path) if csv_path else None,
          'source_label':f'source/{ident}_frames.lbl' if label_path else None,
          'rejected':f'chunks/{ident}_rejected.jsonl','rejected_sha256':sha(reject_path),
          'record_format':'<fffIIHBB','record_bytes':RECORD.size,
          'source_note':'ODE frame query excludes wholly invalid frames'}
    atomic_json(meta_path,meta)
    return meta


def publish():
    entries=[]
    for path in CHUNKS.glob('????_x?_y?.json'):
        try:entries.append(json.loads(path.read_text(encoding='utf8')))
        except (json.JSONDecodeError,OSError):continue
    entries.sort(key=lambda x:x['id'])
    counts=Counter()
    for entry in entries:counts.update(entry['counts'])
    manifest={'format':'LOLA Tycho binary v1','bounds':BOUNDS,'years':[2009,2026],
              'source':'NASA/PDS ODE LOLA RDR frame CSV','reference_radius_m':RADIUS_M,
              'total_jobs':len(YEARS)*4,'completed_jobs':len(entries),'complete':len(entries)==len(YEARS)*4,
              'counts':dict(counts),'chunks':entries,'sampling':'none: full acquired point density',
              'updated_utc':datetime.now(timezone.utc).isoformat()}
    atomic_json(MANIFEST,manifest)
    return manifest


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--one',action='store_true',help='acquire one 2009 tile for a smoke test')
    parser.add_argument('--workers',type=int,default=3)
    args=parser.parse_args()
    SOURCE.mkdir(parents=True,exist_ok=True);CHUNKS.mkdir(parents=True,exist_ok=True)
    products,starts=index_products()
    jobs=[(year,ix,iy) for year in YEARS for iy in range(2) for ix in range(2)]
    if args.one:jobs=jobs[:1]
    publish()
    failures=[]
    with ThreadPoolExecutor(max_workers=max(1,min(4,args.workers))) as pool:
        future={pool.submit(process_tile,*job,products,starts):job for job in jobs}
        for task in as_completed(future):
            job=future[task]
            try:
                entry=task.result();manifest=publish()
                log(f"{entry['id']} accepted={entry['counts'].get('accepted',0)} rejected={entry['counts'].get('rejected',0)} complete={manifest['completed_jobs']}/{manifest['total_jobs']}")
            except Exception as exc:
                item={'job':job,'error':str(exc),'utc':datetime.now(timezone.utc).isoformat()}
                failures.append(item)
                with FAIL.open('a',encoding='utf8') as f:f.write(json.dumps(item)+'\n')
                log(f'FAILED {job}: {exc}')
    manifest=publish()
    log(f"DONE accepted={manifest['counts'].get('accepted',0)} complete={manifest['completed_jobs']}/72 failures={len(failures)} bytes={used_bytes()}")
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
