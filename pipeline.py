"""Build a bounded, reproducible Tycho pilot from NASA/PDS LOLA products.

Run: python pipeline.py. Raw CSV, label, index and the downloaded DEM row span
remain in data/source; display derivatives and rejected shots are separate.
"""
import bisect
import csv
import hashlib
import json
import math
import struct
import subprocess
import urllib.parse
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'data' / 'source'
OUT = ROOT / 'data'
BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/'
DEM_URL = BASE + 'data/lola_gdr/cylindrical/float_img/ldem_64_float.img'
BOUNDS = [346.8, -44.7, 350.8, -41.8]  # east-positive lon, planetocentric lat
QUERY = [348.2, -43.8, 349.6, -42.8]   # bounded 2010 pilot
RADIUS_M = 1737400


def curl(url, dest, byte_range=None, expected=None):
    """Resume whole downloads; cache a byte range only after exact verification."""
    dest = Path(dest)
    if dest.exists() and (expected is None or dest.stat().st_size == expected):
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + '.part')
    cmd = ['curl.exe', '-L', '--retry', '3', '--fail', '--silent', '--show-error']
    if byte_range is None:
        cmd += ['-C', '-', url, '-o', str(part)]
    else:
        part.unlink(missing_ok=True)
        cmd += ['-r', f'{byte_range[0]}-{byte_range[1]}', url, '-o', str(part)]
    try:
        subprocess.run(cmd, check=True, timeout=180)
        if expected is not None and part.stat().st_size != expected:
            raise RuntimeError(f'{url}: got {part.stat().st_size}, expected {expected} bytes')
        part.replace(dest)
    except Exception as exc:
        with (OUT / 'failures.log').open('a') as f:
            f.write(f'{datetime.utcnow().isoformat()} {url}: {exc}\n')
        raise


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def prepare_dem():
    # Pixel centers: lon=(column+.5)/64; lat=90-(row+.5)/64.
    c0 = math.floor(BOUNDS[0] * 64)
    c1 = math.ceil(BOUNDS[2] * 64)
    if c1 <= c0: c1 += 23040  # east-positive region crossing 360°
    r0 = math.floor((90 - BOUNDS[3]) * 64)
    r1 = math.ceil((90 - BOUNDS[1]) * 64)
    rows, cols = r1-r0, c1-c0
    stride = 23040 * 4
    if rows*stride > 64*1024*1024 or rows*cols > 400000:
        raise RuntimeError('Pilot DEM request exceeds 64 MiB or 400,000 vertices; tile the region first')
    start, end = r0*stride, r1*stride-1
    path = SRC / f'ldem_64_rows_{r0}_{r1}.bin'
    curl(DEM_URL, path, (start, end), rows*stride)
    vals = []
    with path.open('rb') as f:
        for _ in range(rows):
            row=f.read(stride)
            if len(row)!=stride:raise RuntimeError('Truncated DEM row span')
            vals.extend(struct.unpack_from('<f',row,((c0+i)%23040)*4)[0] for i in range(cols))
    clean = [v*1000 if math.isfinite(v) and -20 < v < 20 else None for v in vals]
    dem = {'rows':rows,'cols':cols,'row0':r0,'col0':c0,'pixels_per_degree':64,
           'heights_m':clean,'reference_radius_m':RADIUS_M,
           'source':'LDEM_64_FLOAT','source_url':DEM_URL,
           'source_sha256':sha(path),'missing':sum(v is None for v in clean)}
    (OUT/'terrain.json').write_text(json.dumps(dem,separators=(',',':')))
    return dem


def index_products():
    path = SRC/'rdrindex.tab'
    curl(BASE+'index/rdrindex.tab', path, expected=26275925)
    rows=[]
    with path.open(newline='',encoding='latin1') as f:
        for row in csv.reader(f):
            if 'LOLA-3-RDR' not in row[7]: continue
            try:
                start=datetime.fromisoformat(row[9].strip())
                stop=datetime.fromisoformat(row[10].strip())
            except ValueError: continue
            rows.append((start,stop,row[4].strip(),row[1].strip()))
    rows.sort()
    return rows, [r[0] for r in rows]


def inside(lon,lat,bounds):
    west,south,east,north=bounds
    lon=lon%360
    return south<=lat<=north and ((west<=lon<=east) if west<=east else (lon>=west or lon<=east))


def prepare_shots():
    path=SRC/'tycho_frames.csv'
    if not path.exists():
        obtain_frames()
    products,starts=index_products()
    accepted=[];rejected=[];counts=Counter();sources=Counter();dates=[]
    with path.open(newline='',encoding='utf-8-sig') as f:
        for raw_frame in csv.DictReader(f):
            frame={k.strip():v.strip() for k,v in raw_frame.items() if k is not None}
            utc=frame['Coordinated_Universal_Time'].strip()
            # ODE preserves eight fractional digits; Python's datetime accepts six.
            time=datetime.fromisoformat(utc[:26])
            idx=bisect.bisect_right(starts,time)-1
            product=products[idx] if idx>=0 and time<=products[idx][1] else None
            pid=product[2] if product else 'UNRESOLVED'
            for channel in range(1,6):
                prefix=f'D{channel}_'
                try:
                    lon=float(frame[prefix+'Longitude'])%360
                    lat=float(frame[prefix+'Latitude'])
                    rad=float(frame[prefix+'Radius'])
                    flag=int(frame[f'Flg{channel}'])
                except (ValueError,KeyError):
                    counts['parse_error']+=1;continue
                if not inside(lon,lat,QUERY):
                    counts['outside_point_clip']+=1;continue
                counts['raw_spots_in_query']+=1
                reason=[]
                if not (-90<=lat<=90 and 0<=lon<360): reason.append('invalid_coordinate')
                if rad<=0 or rad== -99 or not math.isfinite(rad): reason.append('missing_radius')
                if flag!=0: reason.append('shot_flag_nonzero')
                item={'utc':utc,'lon':lon,'lat':lat,'radius_km':rad,'height_m':round((rad*1000-RADIUS_M),3),
                      'flag':flag,'detector':channel,'frame':int(frame['Frame']),
                      'mission_et':float(frame['Mission_ET']),'product_id':pid,
                      'source_file':product[3] if product else None}
                if reason:
                    item['reasons']=reason;rejected.append(item)
                    for r in reason: counts[r]+=1
                else:
                    accepted.append(item); sources[pid]+=1;dates.append(utc)
    accepted.sort(key=lambda p:(p['utc'],p['product_id'],p['frame'],p['detector']))
    (OUT/'shots.json').write_text(json.dumps(accepted,separators=(',',':')))
    with (OUT/'rejected.jsonl').open('w') as f:
        for p in rejected:f.write(json.dumps(p,separators=(',',':'))+'\n')
    counts['accepted']=len(accepted);counts['rejected']=len(rejected)
    return dict(counts),dict(sources),[min(dates),max(dates)] if dates else [], accepted


def obtain_frames():
    """Use a bounded ODE GDS frame query; never interpret a failed request as no data."""
    params={'query':'lolardr','results':'f','westernlon':QUERY[0],
            'easternlon':QUERY[2],'minlat':QUERY[1],'maxlat':QUERY[3],
            'minobtime':'2010-01-01','maxobtime':'2011-01-01','output':'JSON'}
    url='https://oderest.rsl.wustl.edu/livegds/?'+urllib.parse.urlencode(params)
    response=SRC/'query.json'
    if not response.exists():curl(url,response)
    try:
        data=json.loads(response.read_text())['GDSResults']
        if data.get('Status','').lower()!='success':raise RuntimeError(data)
        files=data['ResultFiles']['ResultFile']
        count=int(data['Count'])
        if count<=0:raise RuntimeError('Query returned zero frames; check service and bounds')
        for item in files:
            ext=Path(urllib.parse.urlparse(item['URL']).path).suffix.lower()
            target=SRC/('tycho_frames.csv' if ext=='.csv' else 'tycho_frames.lbl')
            curl(item['URL'],target)
            if target.stat().st_size<100:raise RuntimeError(f'Truncated {target}')
        with (SRC/'tycho_frames.csv').open(newline='',encoding='utf-8-sig') as f:
            reader=csv.DictReader(f)
            if 'Coordinated_Universal_Time' not in reader.fieldnames:
                raise RuntimeError('Unexpected ODE frame CSV header')
            actual=sum(1 for _ in reader)
        # ODE Count is valid laser spots, while this CSV has one row per
        # minor frame (up to five spots). The generated label misstates ROWS.
        if actual<=0 or actual>count:raise RuntimeError(f'Frame count {actual}, point count {count}')
    except Exception:
        # A stale temporary ODE URL must cause a fresh query on the next run.
        response.unlink(missing_ok=True)
        raise


def main():
    SRC.mkdir(parents=True,exist_ok=True)
    if not (SRC/'ldem_64_float.lbl').exists():
        curl(BASE+'data/lola_gdr/cylindrical/float_img/ldem_64_float.lbl',SRC/'ldem_64_float.lbl')
    dem=prepare_dem()
    counts,sources,dates,shots=prepare_shots()
    meta={'bounds':BOUNDS,'query_bounds':QUERY,'query_time':['2010-01-01','2011-01-01'],
          'reference_radius_m':RADIUS_M,'coordinate_system':'Moon ME/DE421, planetocentric, east-positive longitude',
          'counts':counts,'source_products':sources,'date_range':dates,
          'accepted_extent':{'lon':[min(p['lon'] for p in shots),max(p['lon'] for p in shots)],
                             'lat':[min(p['lat'] for p in shots),max(p['lat'] for p in shots)],
                             'height_m':[min(p['height_m'] for p in shots),max(p['height_m'] for p in shots)]},
          'display_sampling':'none: all accepted pilot shots',
          'raw_csv_sha256':sha(SRC/'tycho_frames.csv'),'rdr_index_sha256':sha(SRC/'rdrindex.tab'),
          'dem_rows_sha256':dem['source_sha256']}
    (OUT/'metadata.json').write_text(json.dumps(meta,indent=2))
    print(json.dumps(meta,indent=2))

if __name__=='__main__':main()
