// ============================================================
// LULC STATISTICS (ESRI Global-LULC 10m Time Series) — Sehore District, MP
// Rewritten from MODIS MCD12Q1 (500m) to ESRI's 10m Impact Observatory
// LULC time series — a 2,500x resolution improvement (500m -> 10m pixels),
// directly fixing the "coarse LULC" weakness flagged throughout this project.
//
// IMPORTANT CLASS SCHEME DIFFERENCE: ESRI's classes are NOT 1-17 IGBP codes
// like MODIS. They use a fixed set with intentional gaps:
//   1 = Water, 2 = Trees, 4 = Flooded Vegetation, 5 = Crops,
//   7 = Built Area, 8 = Bare Ground, 9 = Snow/Ice, 10 = Clouds, 11 = Rangeland
// (values 3 and 6 are not used by this dataset). Remap table below is
// built for THESE values, not MODIS's.
//
// PERFORMANCE WARNING: running a district-wide grouped-reducer at 10m
// instead of 500m is roughly 2,500x more pixels (~65 million pixels across
// Sehore at 10m). This is the same class of computation that caused
// "memory capacity exceeded" errors earlier in this project on Sentinel-2
// work. Run PART 1 (diagnostic/smoke test) first — it's cheap and confirms
// the dataset structure before you commit to the full run in PART 2.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

var esri_lulc_ts = ee.ImageCollection('projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS');

// ============================================================
// PART 1 — DIAGNOSTIC / SMOKE TEST (run this first, alone)
// Confirms band name and actual class values present, cheaply, before
// committing to the full district-wide computation below.
// ============================================================

var firstImage = esri_lulc_ts.first();
var bandName = firstImage.bandNames().get(0);
print('Detected band name:', bandName);
print('First image properties (check for a usable date/year field):', firstImage.toDictionary());
print('Total images in collection:', esri_lulc_ts.size());

// Cheap sanity check: sample a small number of pixels within Sehore to see
// which class values actually appear, confirming they match [1,2,4,5,7,8,9,10,11].
var sampleImg = firstImage.select([bandName]);
var sample = sampleImg.sample({
  region: sehore.geometry(),
  scale: 10,
  numPixels: 200,
  seed: 42
});
print('Sample of class values actually present (should be within 1,2,4,5,7,8,9,10,11):',
  sample.aggregate_array(bandName).distinct());

print('----- IF THE ABOVE LOOKS CORRECT, SCROLL DOWN AND RUN PART 2 -----');
print('If band name is not what you expected, or class values fall outside');
print('1,2,4,5,7,8,9,10,11, STOP and report back before running Part 2 —');
print('the remap table below would silently produce wrong categories.');

// ============================================================
// PART 2 — FULL PIPELINE (only run after confirming Part 1 looks correct)
// ============================================================

function getYearImage(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var filtered = esri_lulc_ts.filterDate(start, end).filterBounds(sehore);
  // Each year is expected to already be one pre-built global mosaic image
  // per time step, so .mosaic() here is a safe no-op if there's only one
  // image, and a correct merge if there happen to be multiple tiles.
  return filtered.select([bandName]).mosaic().clip(sehore);
}

var lulc2017 = getYearImage('2017');
var lulc2020 = getYearImage('2020');

// ---- Remap ESRI classes into the same 8-category scheme used elsewhere
// in this project (Forest, Grass/Savannas, Wetlands, Croplands, Urban,
// Snow/Ice, Barren, Water Bodies) so it plugs into existing report tables
// and comparisons without changing the category framework. ----
// ESRI class -> report category:
//   1  Water              -> 8 Water Bodies
//   2  Trees               -> 1 Forest
//   4  Flooded Vegetation  -> 3 Wetlands
//   5  Crops               -> 4 Croplands
//   7  Built Area          -> 5 Urban
//   8  Bare Ground         -> 7 Barren
//   9  Snow/Ice            -> 6 Snow/Ice
//   10 Clouds              -> masked out entirely (not a real land cover;
//                             counting cloud pixels as any category would
//                             bias the stats — better to exclude them)
//   11 Rangeland           -> 2 Grass/Savannas (closest match: grassland/
//                             shrubland/savanna mix)
var fromClasses = [1, 2, 4, 5, 7, 8, 9, 11];
var toClasses   = [8, 1, 3, 4, 5, 7, 6, 2];

function remapAndMaskClouds(img) {
  var cloudMask = img.neq(10); // exclude class 10 (Clouds) entirely
  return img.updateMask(cloudMask).remap(fromClasses, toClasses).rename('Category');
}

var lulc2017Agg = remapAndMaskClouds(lulc2017);
var lulc2020Agg = remapAndMaskClouds(lulc2020);

var categoryNames = {
  1: 'Forest', 2: 'Grass/Savannas', 3: 'Wetlands', 4: 'Croplands',
  5: 'Urban', 6: 'Snow/Ice', 7: 'Barren', 8: 'Water Bodies'
};

Map.addLayer(lulc2017Agg, {min: 1, max: 8, palette:
  ['358221', 'A7D282', 'D6EFFF', 'FFC34A', 'F096FF', 'FFFFFF', 'DCDCDC', '1A5BFF']}, 'LULC Categories 2017 (10m)');
Map.addLayer(lulc2020Agg, {min: 1, max: 8, palette:
  ['358221', 'A7D282', 'D6EFFF', 'FFC34A', 'F096FF', 'FFFFFF', 'DCDCDC', '1A5BFF']}, 'LULC Categories 2020 (10m)');

// ---- Per-class area (km²) via grouped reducer, at 10m ----
// tileScale + bestEffort added defensively, matching the pattern that
// worked for the 10m water-body feature extraction earlier in this
// project. Expect this to take noticeably longer than the 500m version —
// that's expected given the ~2,500x pixel count increase, not a bug.
function classAreaStats(image, label) {
  var areaImg = ee.Image.pixelArea().addBands(image);
  var stats = areaImg.reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'category'}),
    geometry: sehore.geometry(),
    scale: 10,
    maxPixels: 1e10,
    tileScale: 8,
    bestEffort: true
  });
  return ee.Feature(null, {
    'label': label,
    'groups': stats.get('groups')
  });
}

var stats2017 = classAreaStats(lulc2017Agg, '2017');
var stats2020 = classAreaStats(lulc2020Agg, '2020');

// ---- Change hotspots (any category change 2017->2020) ----
var change = lulc2017Agg.neq(lulc2020Agg).rename('Changed');
Map.addLayer(change, {min: 0, max: 1, palette: ['white', 'red']}, 'LULC Change Hotspots (10m)');

// ---- Export only — do NOT print the full stats interactively. Same
// lesson as earlier in this project: forcing GEE to fully evaluate a
// heavy district-wide grouped reduction just to print it to console is
// what caused memory-limit failures before. Export as CSV, inspect the
// downloaded file instead. ----
Export.table.toDrive({
  collection: ee.FeatureCollection([stats2017, stats2020]),
  description: 'Sehore_LULC_10m_Area_Statistics_2017_2020',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

Export.image.toDrive({
  image: lulc2017, description: 'Sehore_LULC_10m_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e10, folder: 'EPICS'
});
Export.image.toDrive({
  image: lulc2020, description: 'Sehore_LULC_10m_2020',
  scale: 10, region: sehore.geometry(), maxPixels: 1e10, folder: 'EPICS'
});
Export.image.toDrive({
  image: change, description: 'Sehore_LULC_10m_Change_2017_2020',
  scale: 10, region: sehore.geometry(), maxPixels: 1e10, folder: 'EPICS'
});

print('----- LULC 10m EXPORT TASKS QUEUED -----');
print('Category key:', categoryNames);
print('Go to the Tasks tab and Run each. Given the 10m scale, expect these');
print('to take considerably longer than the old 500m MODIS version —');
print('possibly tens of minutes for the stats CSV. If any task fails or');
print('times out, report back the exact error and we will split it into');
print('smaller batches, same fix pattern used earlier for Sentinel-2 work.');
