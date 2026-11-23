# Tycho LOLA atlas

An interactive, full-window Three.js view of **actual LRO/LOLA laser measurements** over a separately rendered **LOLA gridded elevation model**. The regional acquisition now includes every valid ODE RDR return found in the Tycho terrain patch across all released observation years queried, with the documented ODE limitations below. The Washington GEDI viewer supplied the camera, transport, layer, palette and mobile-control interaction patterns; its files and downloads were not changed.

## Run

```powershell
git clone https://github.com/MattMullin/tycho-lola-atlas.git
cd tycho-lola-atlas
npm install
npm run build
python serve.py
```

Open <http://127.0.0.1:8766/>. This repository already contains the bounded Tycho DEM, optical crop, 2010 fallback sample, and all 72 accepted-shot display chunks. The 72 rejected-record JSONL files are in `data/full/rejected-records.zip`. The 422.9 MB original ODE frame CSV cache is not committed; the manifest retains its source URLs and SHA-256 hashes. On Windows, reacquire the originals and repeat the full audit with:

```powershell
python -m pip install -r requirements.txt
python pipeline.py
python acquire_full.py --workers 3
python fetch_optical.py
python verify_full.py
```

The acquisition stays bounded to Tycho and uses a 1.5 GB guard. Install a Chromium browser for Playwright with `npx playwright install chromium`, or set `BROWSER_EXECUTABLE` to a local Chrome or Edge executable. To verify the included data after the browser test writes screenshots:

```powershell
node verify_viewer.cjs
python verify_data.py
python verify_published.py
```

The original 2010 pilot display files are `data/shots.json`, `data/rejected.jsonl`, and `data/metadata.json`; reacquiring its raw inputs populates `data/source`. The completed regional expansion display files are in `data/full`. `pipeline.py` reuses completed files, resumes interrupted whole-file downloads, verifies the byte count of the DEM range, checks the ODE response and CSV header, and logs failures in `data/failures.log`. `acquire_full.py` resumes each completed tile/year query and writes failures to `data/full/failures.jsonl`. An HTTP or parse failure raises an error; it is never treated as an empty observation. The 1.5 GB expansion budget, 64 MiB DEM-range and 400,000-vertex guards prevent accidental broad downloads. The full global high-resolution DEM was never fetched.

## Optional optical surface

The **Surface transition** slider runs from **DEM heatmap (0%)** to **LROC WAC optical image (100%)**. Intermediate positions alpha blend the two visual layers on the same LOLA terrain geometry; they do not interpolate measurements or elevation values. The **Inspect LROC image** button jumps to the optical end and temporarily hides the laser shots and traces so the image is easy to see; **Restore laser layers** returns to the previous slider and layer settings. **Laser dots at optical end** sets measured point opacity at the optical endpoint (15% by default); point opacity changes smoothly from 100% at the DEM endpoint as the surface slider moves. These display controls do not alter elevations, shot positions or acquisition counts. Turning off **Lunar surface (LOLA geometry)** or enabling **Measured points only** hides both surface appearances.

`python fetch_optical.py` requests only the Tycho patch from the [USGS Astrogeology lunar WMS](https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map&service=WMS&request=GetCapabilities) `LROC_WAC` layer, a grayscale ASU LRO Wide Angle Camera global mosaic released in June 2013 and updated at its edges in February 2016. The image is **1,542 × 1,116 pixels, 1.56 MB**. Its exact lunar east-positive lon/lat bounds come from the LOLA DEM grid: **346.796875–350.8125° E, −44.703125 to −41.796875°**. The WMS calls this coordinate request `EPSG:4326`, but its map is a lunar simple cylindrical map; no Earth datum is used in placement. The image is a mosaicked optical texture with illumination and shadows, not a single-date photograph or elevation source. The original WMS response is cached as `data/optical_tycho.png`; `data/optical_tycho.json` records its URL, bounds, UTC retrieval time, size and SHA-256. A failed request is logged in `data/optical_failures.log` and raises an error. The mosaic is available at the regional resolution of the source product; requesting more output pixels does not create extra detail. For larger regions, request bounded tiles from the same WMS rather than a global high-resolution raster.

## DEM elevation heatmap

**DEM elevation heatmap** is on by default. The LOLA GDR grid colors the terrain continuously by height above the **1,737.4 km lunar reference sphere** while its 3D geometry and lighting preserve crater relief. The default topographic palette runs from violet/blue for low ground through teal to yellow for high ground. The legend, four editable color stops, palette reversal and color limits apply to both DEM colors and the separate measured shot colors. Color limits clamp the colors; they do not remove terrain cells. Vertical exaggeration changes geometry only, not the elevation value mapped to color. Turn off **DEM elevation heatmap** for neutral shaded relief at the slider’s left endpoint. No optical brightness is interpreted as elevation. `verify_viewer.cjs` captures heatmap, neutral, reversed-palette, middle mix and optical views; `verify_data.py` checks that their terrain pixels differ.

## Full Tycho acquisition

The exact outer patch is **346.8–350.8° E, −44.7 to −41.8° latitude**. It is divided into four spatial tiles and yearly 2009–2026 ODE GDS frame queries, with **0.03° query padding** to recover shots whose frame center falls just outside a tile. Individual detector locations are clipped back to nonoverlapping half-open tile boundaries. The accepted deduplication key is PDS product ID, UTC second, UTC microsecond, and detector. No altitude or channel filter is applied. The product ID is resolved from the PDS RDR index using the observation UTC. Each verified tile is published atomically in `data/full/manifest.json`; the viewer polls the manifest and loads new binary chunks progressively without interrupting the already-published tiles.

The completed acquisition has **72 successful queries, 1,598,621 accepted shots, 251,878 rejected detector entries, and 492 source PDS RDR products**. Accepted observations span **2009-07-14T13:00:56 to 2021-06-21T10:15:42 UTC** in this region. ODE returned successful zero-count results for several later years, including 2022–2026. This is a statement about this ODE query, not proof that every archived RDR file lacks a Tycho detector event. The full audit confirms all accepted records are unique, UTC ordered inside their chunks, within the Tycho bounds, and have flag 0. The sampled nearest-cell shot minus DEM median is **−0.99 m** and 95th percentile absolute difference **83.86 m**; interpolation and steep crater slopes matter. See `data/full/verification.json`.

When reacquired, the raw frame CSVs, labels and ODE responses are kept under `data/full/source` (**422.9 MB**). Accepted display records are separate 24-byte little-endian files under `data/full/chunks` (**38.4 MB** total), preserving location, height, UTC seconds and microseconds, detector, flag and a per-chunk PDS product index. Rejected entries retain their quality flag and reasons in the compressed `data/full/rejected-records.zip` archive. The full local acquisition tree occupies **536.6 MB**; this repository includes the bounded display derivatives and the rejected-record archive. The compact display coordinates are float32; the original CSVs retain the source coordinate precision and other instrument fields.

At overview zoom the viewer displays **about one in 16** acquired shots from each UTC-ordered chunk to keep relief readable. At medium zoom it displays about one in 8. A deterministic hash of each shot's ordinal chooses the subset, avoiding a fixed detector cadence. At zoom ≥3 or with **Point density → Full acquired**, it renders every accepted shot. The count and acquisition timeline always refer to the full acquired set, and the legend states the current display sampling. The measured-shot layer remains discrete; the optional trace connectors described below are a separate decorative layer.

### Animated pass traces

**Pass buildup · compressed UTC** is the default reveal. It orders the 492 PDS RDR products by their first Tycho observation, compresses quiet time between them, and progressively adds their real measured footprints. The optional acceleration increases playback speed as progress advances; this is a presentation time scale, not the historical LRO speed. **Acquisition tracks · UTC** remains available when proportional observation time matters. Neither mode models spacecraft ephemeris or claims a continuous instrument swath.

The optional **Decorative laser traces** layer draws short dashed connectors only between successive *valid* returns from the same PDS product and detector, within **0.045 s** and **200 m**. A deterministic one-in-eight selection keeps the accumulated connectors separated; the current pass highlights about one in four eligible pairs and their real measured endpoints. Up to five mint columns linger at earlier measured endpoints on the active pass, at least 7 km apart. Their 7.5 km length, width, glow and simultaneous display are artistic effects, not spacecraft altitude, range or a record of concurrent firing. Trace connectors and beams are never used as elevation data. The trace layer can be turned off independently of the measured points. The darker relief and moonlight palette take visual inspiration from the [GEDI animation reference](https://x.com/matthewwmullin/status/2122163514215219631); the lunar surface remains a LOLA elevation grid and contains no modeled vegetation.

## Official data and definitions

* [PDS LOLA FAQ](https://pds-geosciences.wustl.edu/missions/lro/lola_faq.htm): RDRs are individual altimetry tracks; GDRs are latitude–longitude grids.
* [PDS RDR product SIS](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/document/rdrsis.htm) and [ODE RDR description](https://ode.rsl.wustl.edu/mercury/pagehelp/Content/Missions_Instruments/Lunar%20Reconnaissance%20Orbiter%20%28LRO%29/LOLA/RDR.htm): calibrated geolocated shots, planetocentric Moon-fixed coordinates, east-positive longitude. The archive uses Moon Mean-Earth/polar-axis coordinates. The binary shot flags mark valid measurements with **flag 0**. The RDR radius is measured from the lunar center of mass; height in this app is `1000 × radius_km − 1,737,400 m`.
* [PDS GDS REST manual](https://oderest.rsl.wustl.edu/GDS_REST_V2.0.pdf), section 4.5: a frame CSV retains the five detector flags and UTC time; point CSVs already discard flagged points. The query tool clips by frame and may include detector locations outside the requested bounds, so this pipeline applies its own point-level clip. The tool returns only frames containing at least one valid shot, so the rejected file is **not a complete census of all instrument failures**.
* [LDEM_64_FLOAT product label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/float_img/ldem_64_float.lbl): 64 pixels per degree, little-endian 32-bit floating point kilometers above a 1,737.4 km sphere, pixel-registered longitude 0–360° E and latitude 90° N to 90° S, Moon ME/DE421. The DEM is an interpolated map and spans observations through November 2016. It is **not** a layer of individual laser returns.
* [PDS LOLA archive](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) holds the RDR index used to resolve each query UTC to its `LOLARDR_*` PDS product identifier, which serves as the pass identifier in this regional atlas. The ODE frame CSV lacks a separate orbit-number column.

The height legend names the spherical reference surface. It is elevation relative to that sphere, not geoid or Earth height. The GDR and RDR use the same 1,737.4 km height reference here. Planetopotential topography relative to a lunar equipotential surface would be a different quantity.

## Reproducible acquisition and processing

The ODE GDS query used for the **measured** pilot is:

```text
https://oderest.rsl.wustl.edu/livegds/?query=lolardr&results=f&westernlon=348.2&easternlon=349.6&minlat=-43.8&maxlat=-42.8&minobtime=2010-01-01&maxobtime=2011-01-01&output=JSON
```

`pipeline.py` obtains its temporary frame-CSV and label URLs from that response when the cached `data/source/tycho_frames.csv` is absent. The response is retained as `data/source/query.json`. The source CSV, label, RDR index, DEM label and exact 17.1 MB DEM byte range remain in `data/source/`, separate from the display-ready `data/shots.json` and `data/terrain.json`. `data/rejected.jsonl` retains rejected detector records with UTC, detector, frame, radius, flag, resolved product ID and rejection reasons. `data/metadata.json` records file hashes, counts, extent and source products.

The source frame CSV has **12,969 frame rows**. Its ODE response reports **38,807 valid laser spots**; the generated label's `ROWS=38807` refers to that point count despite the frame-row format. The pipeline checks records and final counts rather than relying on that label field.

The terrain region is 346.8–350.8° E, 44.7–41.8° S; the smaller measured-shot query is 348.2–349.6° E, 43.8–42.8° S, during 2010. Both layers are transformed from lunar spherical coordinates to an east/up/south local frame centered at 348.8° E, 43.25° S. Earth projections are not used. The scene retains the reference sphere's curvature, even at true vertical scale. For a future whole-Moon viewer, use the same Moon-fixed spherical radius in body-fixed Cartesian coordinates on a curved globe, with pass and spatial tiles loaded incrementally. Longitude wrap is handled in both the clip test and DEM column indexing; the spherical conversion is stable at high latitudes, while global polar tiling would need a separate tile layout.

## Filters, extent and visual semantics

In the original 2010 pilot, of 47,745 detector entries whose individual coordinates lie in its point query, 38,807 are retained (`flag=0` and finite measured radius) and 8,938 are retained in the rejected file. Rejection reasons overlap: 8,938 nonzero flags and 8,226 missing-radius sentinels. Another 17,100 channel entries in the returned frames lie outside the point query, often because missing-shot placeholders have dummy coordinates; those are counted separately and not treated as sampled measurements. The pilot derivative contains all 38,807 accepted shots without processing-time sampling. They span 348.2229209–349.4515925° E, −43.7999379 to −42.8000681° planetocentric latitude, heights −3542.709 to −997.922 m, and UTC 2010-01-08T05:37:40 through 2010-12-29T04:52:07. The 28 resolved PDS product IDs are listed in the pilot metadata.

The DEM decoder treats non-finite values and heights outside ±20 km as missing, a sanity limit broader than this product label's stated −9.125 to +10.773 km range; this Tycho crop has zero missing cells. It does not turn missing cells into measured shots. The original CSV preserves the other instrument fields even though the compact viewer derivative carries only the fields needed to locate, order, identify, and quality-screen each shot.

Acquisition playback reveals discrete, unconnected footprints in UTC order. The expanded viewer's slider spans the loaded observations' UTC range, so quiet periods occupy time on the slider. The product ID shown next to the timestamp identifies the most recently revealed pass. The light curtain is a **decorative spatial sweep**, clipped to the Tycho region and following DEM relief. Its glow and the point halos are visual effects, not measured beams. The 6× starting vertical scale is labeled and can be set to 1×. The DEM is a static later multi-year product, so shot-to-grid differences also reflect interpolation, resolution, and product epochs. At the nearest 64-pixel-per-degree DEM cell, the original 2010 pilot's shot minus grid difference has a median of −2.18 m and a 95th percentile absolute difference of 68.82 m; steep crater slopes account for many larger differences. The screen draws points over terrain for visibility, while their 3D positions use their measured radii.

## Scaling boundary

This build completes the regional Tycho acquisition and stops before a global download. The complete 64-pixel-per-degree GDR is 1,061,683,200 bytes and the 128-pixel-per-degree GDR is 4,246,732,800 bytes by the PDS directory listings. ODE reported about **6.94 billion** LOLA observations at query time; even a compact 64-byte record per return would exceed **444 GB**, before indexes and alternate products. Any broader acquisition should first choose spatial/time tiles and a disk budget and place the data on a curved lunar globe. No global download was started.

## Verification

`verify_data.py` tests the original pilot's wrapped longitude clipping, point and quality counts, UTC order, radius-to-height conversion, local-scale distance, point/DEM alignment and screenshot pixels. `verify_full.py` audits every accepted full-coverage record, every rejected count, binary and source hashes, timestamps, product IDs, geographic clip, uniqueness and terrain alignment. `verify_viewer.cjs` uses Playwright to exercise progressive/full-density display, acquisition and curtain reveals, play/pause, orbit, zoom/pan, true scale, palette reversal and desktop/mobile layouts. `node capture_cinematic.cjs` captures a closer pass view after the server starts. Screenshots are saved beside the app.
