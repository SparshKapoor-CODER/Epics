// ============================================================
// WATER BODY COUNT — Connected Component Labeling
// Answers: how many DISTINCT water bodies (ponds/tanks/lakes) actually
// exist in Sehore, as opposed to raw pixel area? This determines whether
// the health-card clustering step should use k-means (needs enough
// distinct water bodies to find real structure) or a simpler transparent
// weighted-score formula (better if the count is small, e.g. under ~20).
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

function getWaterMask(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .select(['B3', 'B4', 'B8', 'SCL']) // band-mismatch fix, same as other scripts
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); });
  var ndwi = collection.map(function(img) {
    return img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  }).mean();
  return ndwi.gt(0.1).selfMask().rename('water');
}

var waterMask2024 = getWaterMask('2024');

// ---- Vectorize directly: reduceToVectors() already treats each connected
// group of water pixels as one polygon, with no size cap — unlike
// ee.Image.connectedComponents(), which hard-caps segment size at 1024
// pixels (~10.24 ha at 10m resolution) and MASKS OUT anything larger.
// That would have silently excluded Sehore's biggest reservoirs from the
// count, which is the opposite of what we want. ----
var vectors = waterMask2024.reduceToVectors({
  geometry: sehore.geometry(),
  crs: 'EPSG:4326',
  scale: 10,
  geometryType: 'polygon',
  eightConnected: false,
  maxPixels: 1e9,
  tileScale: 4
});

// Add area (hectares) to each polygon, then filter out noise blobs
// smaller than 0.5 hectares — adjust this threshold if needed once you
// see the distribution.
var vectorsWithArea = vectors.map(function(f) {
  var areaHa = f.geometry().area().divide(10000);
  return f.set('area_ha', areaHa);
});

var realWaterBodies = vectorsWithArea.filter(ee.Filter.gte('area_ha', 0.5));

// ---- Export counts and a size-distribution summary as CSV. Deliberately
// NOT printing the full vector collection or its .size() directly here —
// same reasoning as the time-series script earlier (interactive
// evaluation of a heavy multi-step vectorization can hit memory limits).
// ----
var summary = ee.FeatureCollection([
  ee.Feature(null, {
    'metric': 'total_blobs_before_size_filter',
    'value': vectorsWithArea.size()
  }),
  ee.Feature(null, {
    'metric': 'distinct_water_bodies_after_0.5ha_filter',
    'value': realWaterBodies.size()
  })
]);

Export.table.toDrive({
  collection: summary,
  description: 'Sehore_Water_Body_Count_Summary',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

// Also export the actual filtered water body polygons with their areas —
// this becomes the base layer for feature extraction (script 13) once
// we know the count is workable.
Export.table.toDrive({
  collection: realWaterBodies.select(['area_ha']),
  description: 'Sehore_Distinct_Water_Bodies_2024',
  fileFormat: 'SHP',
  folder: 'EPICS'
});

print('----- TWO EXPORT TASKS QUEUED -----');
print('1) Sehore_Water_Body_Count_Summary (CSV) — the actual count you need.');
print('2) Sehore_Distinct_Water_Bodies_2024 (SHP) — each water body as its');
print('   own polygon with area in hectares, ready for feature extraction later.');
print('Go to the Tasks tab and Run both.');
