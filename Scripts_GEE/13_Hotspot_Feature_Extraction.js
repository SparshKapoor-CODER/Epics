// ============================================================
// HOTSPOT FEATURE EXTRACTION — one row per distinct water body
// Builds the feature table that feeds the k-means health-card clustering
// step. For each of the 92 water bodies found by script 12:
//   - NDWI-based % area change 2017 -> 2024
//   - Catchment NDVI change (mean, within a SIZE-SCALED buffer)
//   - % cropland within that same buffer
//   - % urban/built within that same buffer
//   - The buffer radius actually used (for transparency/reporting)
//
// Buffer scaling: each water body's catchment zone = 5x its own
// equivalent radius (sqrt(area/pi)), clamped between 100m and 2000m.
// This keeps small ponds getting small catchments and large reservoirs
// getting large ones, rather than one fixed buffer for every site.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

// ---- Load the 92 distinct water bodies exported by script 12 ----
// IMPORTANT: replace this with the actual GEE asset path after importing
// Sehore_Distinct_Water_Bodies_2024.shp as a GEE asset (Assets tab ->
// New -> Table upload -> select the .shp from your Drive/local download).
var waterBodies = ee.FeatureCollection('projects/uk-forest/assets/sehore_distinct_water_bodies_2024');

function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

function getIndicesComposite(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .select(['B3', 'B4', 'B8', 'SCL'])
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); });
  var ndwi = collection.map(function(img) {
    return img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  }).mean();
  var ndvi = collection.map(function(img) {
    return img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  }).mean();
  return ndwi.addBands(ndvi);
}

var composite2017 = getIndicesComposite('2017');
var composite2024 = getIndicesComposite('2024');

// ---- Dynamic World for cropland/urban % within each buffer (10m,
// matches the resolution everything else here uses) ----
var dw2024 = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(sehore)
  .filterDate('2024-01-01', '2024-12-31')
  .select('label')
  .mode()
  .clip(sehore);
// Dynamic World classes: 4 = crops, 6 = built
var croplandMask = dw2024.eq(4);
var urbanMask = dw2024.eq(6);

// ---- Per-water-body feature extraction ----
function extractFeatures(wb) {
  var areaM2 = wb.geometry().area(1);
  var equivRadius = areaM2.divide(Math.PI).sqrt();
  var rawBuffer = equivRadius.multiply(5);
  var bufferDist = rawBuffer.max(100).min(2000); // clamp 100m-2000m

  var catchment = wb.geometry().buffer(bufferDist, 1).difference(wb.geometry(), 1);
  // "difference" excludes the water body's own footprint from its
  // catchment ring, so we're measuring the surrounding land, not the
  // water itself.

  // NDWI-based water area change for THIS specific water body
  var waterMask2017 = composite2017.select('NDWI').gt(0.1);
  var waterMask2024 = composite2024.select('NDWI').gt(0.1);

  var area2017 = waterMask2017.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: wb.geometry(),
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  }).get('NDWI');

  var area2024 = waterMask2024.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: wb.geometry(),
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  }).get('NDWI');

  var area2017Num = ee.Number(area2017);
  var area2024Num = ee.Number(area2024);
  var pctChange = area2024Num.subtract(area2017Num)
    .divide(area2017Num.max(1)) // avoid divide-by-zero if 2017 area was 0
    .multiply(100);

  // Catchment NDVI change (mean within the scaled buffer ring)
  var ndviMean2017 = composite2017.select('NDVI').reduceRegion({
    reducer: ee.Reducer.mean(), geometry: catchment,
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  }).get('NDVI');
  var ndviMean2024 = composite2024.select('NDVI').reduceRegion({
    reducer: ee.Reducer.mean(), geometry: catchment,
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  }).get('NDVI');
  var ndviChange = ee.Number(ndviMean2024).subtract(ee.Number(ndviMean2017));

  // % cropland and % urban within the catchment ring
  var catchmentAreaM2 = catchment.area(1);
  var croplandAreaM2 = croplandMask.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: catchment,
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  }).get('label');
  var urbanAreaM2 = urbanMask.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: catchment,
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  }).get('label');

  var pctCropland = ee.Number(croplandAreaM2).divide(catchmentAreaM2).multiply(100);
  var pctUrban = ee.Number(urbanAreaM2).divide(catchmentAreaM2).multiply(100);

  return wb.set({
    'area_ha_2024': areaM2.divide(10000),
    'buffer_dist_m': bufferDist,
    'water_pct_change_17_24': pctChange,
    'catchment_ndvi_change': ndviChange,
    'catchment_pct_cropland': pctCropland,
    'catchment_pct_urban': pctUrban
  });
}

var featureCollection = waterBodies.map(extractFeatures);

// ---- Export only. Do NOT print/inspect the full featureCollection here —
// this repeats the exact heavy-computation pattern that caused memory/
// timeout errors earlier (92 water bodies x multiple reduceRegion calls
// each is a lot of interactive work). Check results in the CSV instead. ----
Export.table.toDrive({
  collection: featureCollection.select([
    'area_ha_2024', 'buffer_dist_m', 'water_pct_change_17_24',
    'catchment_ndvi_change', 'catchment_pct_cropland', 'catchment_pct_urban'
  ]),
  description: 'Sehore_WaterBody_Features_for_Clustering',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

print('----- FEATURE EXTRACTION EXPORT QUEUED -----');
print('Go to the Tasks tab and Run it. With 92 water bodies each needing');
print('~6 separate reduceRegion calls, this WILL take a while (likely');
print('several minutes to tens of minutes) — that is expected, not a bug.');
print('If it fails on memory/timeout, tell me and we will split it into');
print('two or three batches of ~30-40 water bodies each, same pattern as');
print('the time-series fix earlier.');
print('');
print('REMINDER: before running, you must first upload');
print('Sehore_Distinct_Water_Bodies_2024.shp as a GEE Asset and update the');
print('"waterBodies" variable path near the top of this script to match.');
