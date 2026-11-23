"""Audit every published Tycho shot, rejected-record count, and source cache."""
import hashlib
import json
import math
import statistics
import struct
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parent
FULL=ROOT/'data'/'full'
manifest=json.loads((FULL/'manifest.json').read_text())
dem=json.loads((ROOT/'data'/'terrain.json').read_text())
record=struct.Struct('<fffIIHBB')
epoch=datetime(2009,1,1)

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

assert manifest['complete'] and manifest['completed_jobs']==72
assert record.size==24
assert manifest['reference_radius_m']==1737400
total=0;rejected=0;dates=[];products=set();seen=set();bounds=[math.inf,math.inf,-math.inf,-math.inf];heights=[math.inf,-math.inf];residual=[]
by_year=Counter()
for entry in manifest['chunks']:
    path=FULL/entry['binary'];expected=entry['counts']['accepted']
    assert path.stat().st_size==expected*record.size,(entry['id'],'size')
    assert sha(path)==entry['binary_sha256'],(entry['id'],'sha')
    if entry['source_csv']:
        source=FULL/entry['source_csv']
        assert sha(source)==entry['source_csv_sha256'],(entry['id'],'source sha')
        assert (FULL/entry['source_label']).exists()
    previous=(-1,-1)
    with path.open('rb') as f:
        for i in range(expected):
            lon,lat,height,sec,us,pid,detector,flag=record.unpack(f.read(record.size))
            assert (sec,us)>=previous,(entry['id'],'order')
            previous=(sec,us)
            if i==0:dates.append(epoch+timedelta(seconds=sec,microseconds=us))
            assert flag==0 and 1<=detector<=5 and 0<=pid<len(entry['products'])
            assert math.isfinite(lon) and math.isfinite(lat) and math.isfinite(height)
            west,south,east,north=entry['bounds']
            assert west-0.0001<=lon<=east+0.0001 and south-0.0001<=lat<=north+0.0001,(entry['id'],lon,lat)
            utc=epoch+timedelta(seconds=sec,microseconds=us)
            assert utc.year==entry['year'],(entry['id'],utc)
            key=(entry['products'][pid],sec,us,detector)
            assert key not in seen,('duplicate',entry['id'],key)
            seen.add(key)
            products.add(entry['products'][pid]);total+=1;by_year[utc.year]+=1
            bounds[0]=min(bounds[0],lon);bounds[1]=min(bounds[1],lat);bounds[2]=max(bounds[2],lon);bounds[3]=max(bounds[3],lat)
            heights[0]=min(heights[0],height);heights[1]=max(heights[1],height)
            if i%101==0:
                col=round(lon*64-.5)-dem['col0'];row=round((90-lat)*64-.5)-dem['row0']
                if 0<=col<dem['cols'] and 0<=row<dem['rows']:
                    ground=dem['heights_m'][row*dem['cols']+col]
                    if ground is not None:residual.append(height-ground)
    if expected:dates.append(epoch+timedelta(seconds=previous[0],microseconds=previous[1]))
    reject_path=FULL/entry['rejected']
    assert sha(reject_path)==entry['rejected_sha256']
    with reject_path.open(encoding='utf8') as f:
        for line in f:
            item=json.loads(line);assert item['reasons'] and item['flag']!=0
            rejected+=1
    assert rejected<=manifest['counts']['rejected']

assert total==manifest['counts']['accepted'] and rejected==manifest['counts']['rejected']
assert not (FULL/'failures.jsonl').exists()
absolute=sorted(abs(x) for x in residual)
report={'passed':True,'accepted':total,'rejected':rejected,'source_products':len(products),
        'geographic_extent_east_lon_south_north_lat':bounds,'height_m':heights,
        'observation_utc':[min(dates).isoformat(),max(dates).isoformat()],
        'by_year':dict(sorted(by_year.items())),
        'terrain_alignment_sample':{'n':len(residual),'median_m':statistics.median(residual),
                                    'p95_abs_m':absolute[int(.95*len(absolute))]},
        'display_binary_bytes':sum((FULL/e['binary']).stat().st_size for e in manifest['chunks']),
        'source_cache_bytes':sum(p.stat().st_size for p in (FULL/'source').glob('*') if p.is_file())}
(FULL/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
