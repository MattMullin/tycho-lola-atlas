import json
import hashlib
import math
import statistics
import unittest
from pathlib import Path
from PIL import Image, ImageChops
from pipeline import inside, RADIUS_M

ROOT=Path(__file__).resolve().parent
data=json.loads((ROOT/'data/metadata.json').read_text())
shots=json.loads((ROOT/'data/shots.json').read_text())
dem=json.loads((ROOT/'data/terrain.json').read_text())

class LOLAPilotTests(unittest.TestCase):
    def test_wrap_and_clip(self):
        self.assertTrue(inside(-11.2,-43.3,data['bounds']))
        self.assertTrue(inside(359.5,0,[358,-1,1,1]))
        self.assertTrue(inside(.5,0,[358,-1,1,1]))
        self.assertFalse(inside(10,0,[358,-1,1,1]))
        self.assertFalse(inside(348.8,-50,data['bounds']))

    def test_observation_order_and_quality(self):
        self.assertEqual(len(shots),38807)
        self.assertEqual(data['counts']['raw_spots_in_query'],47745)
        self.assertEqual(data['counts']['rejected'],8938)
        self.assertEqual(data['counts']['accepted']+data['counts']['rejected'],data['counts']['raw_spots_in_query'])
        self.assertEqual([s['utc'] for s in shots],sorted(s['utc'] for s in shots))
        self.assertTrue(all(s['flag']==0 and inside(s['lon'],s['lat'],data['query_bounds']) for s in shots))
        self.assertTrue(all(s['product_id'].startswith('LOLARDR_') for s in shots))

    def test_radius_and_local_frame(self):
        self.assertAlmostEqual(shots[0]['height_m'],shots[0]['radius_km']*1000-RADIUS_M,places=3)
        lon0,lat0=348.8,-43.25
        self.assertAlmostEqual(RADIUS_M*(math.radians((lon0+.1)-lon0))*math.cos(math.radians(lat0)),2212.0,delta=5)
        self.assertLess(abs(RADIUS_M*(math.radians(-.1))),3100)

    def test_dem_alignment(self):
        residuals=[]
        for p in shots:
            col=round(p['lon']*64-.5)-dem['col0']
            row=round((90-p['lat'])*64-.5)-dem['row0']
            if 0<=col<dem['cols'] and 0<=row<dem['rows']:
                ground=dem['heights_m'][row*dem['cols']+col]
                if ground is not None:residuals.append(p['height_m']-ground)
        self.assertEqual(len(residuals),len(shots))
        self.assertLess(abs(statistics.median(residuals)),15)
        self.assertLess(sorted(abs(v) for v in residuals)[int(.95*len(residuals))],150)

    def test_optical_georeferencing(self):
        provenance=json.loads((ROOT/'data/optical_tycho.json').read_text())
        west,south,east,north=provenance['bounds_lon_lat_east_positive']
        self.assertEqual([west,south,east,north],[dem['col0']/64,90-(dem['row0']+dem['rows'])/64,(dem['col0']+dem['cols'])/64,90-dem['row0']/64])
        self.assertAlmostEqual((348.8-west)/(east-west),.5,delta=.05)
        self.assertAlmostEqual((-43.25-south)/(north-south),.5,delta=.05)
        raw=(ROOT/'data/optical_tycho.png').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),provenance['sha256'])
        with Image.open(ROOT/'data/optical_tycho.png') as optical:
            self.assertEqual(list(optical.size),provenance['image_size_px'])

    def test_canvas_pixels(self):
        a=Image.open(ROOT/'tycho_real_data_desktop.png').convert('RGB')
        b=Image.open(ROOT/'tycho_palette_reversed.png').convert('RGB')
        c=Image.open(ROOT/'tycho_curtain.png').convert('RGB')
        full=Image.open(ROOT/'tycho_full_density.png').convert('RGB')
        optical=Image.open(ROOT/'tycho_optical.png').convert('RGB')
        mixed=Image.open(ROOT/'tycho_surface_mix.png').convert('RGB')
        optical_only=Image.open(ROOT/'tycho_optical_only.png').convert('RGB')
        heatmap=Image.open(ROOT/'tycho_dem_heatmap.png').convert('RGB')
        neutral=Image.open(ROOT/'tycho_dem_neutral.png').convert('RGB')
        heatmap_reversed=Image.open(ROOT/'tycho_dem_reversed.png').convert('RGB')
        pass_on=Image.open(ROOT/'tycho_pass_buildup.png').convert('RGB')
        pass_off=Image.open(ROOT/'tycho_pass_without_traces.png').convert('RGB')
        self.assertEqual(a.size,(1440,900))
        self.assertGreater(sum(1 for r,g,b0 in a.crop((320,160,1120,720)).getdata() if r+g+b0>160),30000)
        center=(360,170,1100,710)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(a,b).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(a,c).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(a,full).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(a,optical).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(a,mixed).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(mixed,optical).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(optical,optical_only).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(heatmap,neutral).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(heatmap,heatmap_reversed).crop(center).getdata() if r+g+bl>30),3000)
        self.assertGreater(sum(1 for r,g,bl in ImageChops.difference(pass_on,pass_off).crop(center).getdata() if r+g+bl>30),250)
        with Image.open(ROOT/'tycho_mobile.png') as mobile:
            self.assertEqual(mobile.size,(390,844))

if __name__=='__main__':unittest.main()
