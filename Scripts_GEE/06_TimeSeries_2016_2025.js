// ============================================================
// MULTI-YEAR TIME SERIES (2016-2025) — NDWI + NDVI
// Extends the existing 2-point (2017 vs 2024) analysis into a real
// time series, needed for any forecasting/trend ML model.
//
// FIX #4 (performance, not just memory): the previous version clipped
// EVERY individual Sentinel-2 scene to the district boundary inside
// .map(), before compositing — expensive geometry work repeated for
// every one of the ~50-100+ scenes per year. filterBounds() already
// restricts to intersecting tiles; the exact clip only needs to happen
// ONCE, on the final composite. Combined with tileScale:16 (which was
// forcing GEE to rebuild that already-expensive composite up to 16x
// over), this is what caused tasks to run 1+ hour with tens of
// thousands of EECU-seconds instead of finishing in minutes.
//
// This version:
//   1. Clips only the final composite, not every input scene.
//   2. Uses a moderate tileScale (2) instead of 16.
//   3. Runs stats at scale 30 instead of 10 for this scalar time-series
//      export specifically — we only need a district-wide area/mean
//      NUMBER per year for the ML trend, not a precise raster, so 30m
//      is more than adequate and cuts pixel count ~9x. (Your actual
//      map rasters from 01/02 stay at 10m — this only affects this
//      lightweight stats script.)
//   4. Includes a SINGLE-YEAR SMOKE TEST first — run this alone, confirm
//      it finishes in a few minutes with reasonable EECU usage, before
//      re-queuing the full 5-year batches below it.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

function addIndices(img) {
  var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return img.addBands(ndwi).addBands(ndvi);
}

function getYearComposite(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(maskS2clouds)
    .map(addIndices)
    .select(['NDWI', 'NDVI']);
  // Composite FIRST, clip ONCE afterward — not per input scene.
  return collection.mean().clip(sehore);
}

function getYearStats(year) {
  var composite = getYearComposite(year);

  var waterMask = composite.select('NDWI').gt(0.1);
  var waterArea = waterMask.multiply(ee.Image.pixelArea())
    .reduceRegion({
      reducer: ee.Reducer.sum(), geometry: sehore.geometry(),
      scale: 30, maxPixels: 1e9, tileScale: 2, bestEffort: true
    }).get('NDWI');

  var meanNDVI = composite.select('NDVI').reduceRegion({
    reducer: ee.Reducer.mean(), geometry: sehore.geometry(),
    scale: 30, maxPixels: 1e9, tileScale: 2, bestEffort: true
  }).get('NDVI');

  return ee.Feature(null, {
    'year': parseInt(year, 10),
    'water_area_sqkm': ee.Number(waterArea).divide(1e6),
    'mean_ndvi': meanNDVI
  });
}

// ============================================================
// STEP 1 — SMOKE TEST: run this block ALONE first (comment out Step 2
// below, or just run this section). Confirm it completes in a few
// minutes with reasonable EECU usage before trusting the full batch.
// ============================================================
var smokeTestFeature = getYearStats('2024');
var smokeTestFC = ee.FeatureCollection([smokeTestFeature]);

Export.table.toDrive({
  collection: smokeTestFC,
  description: 'Sehore_TimeSeries_SMOKETEST_2024',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

print('----- SMOKE TEST QUEUED: Sehore_TimeSeries_SMOKETEST_2024 -----');
print('Run ONLY this task first. It should finish in a few minutes.');
print('Check its EECU usage in the Tasks tab once done — if it is in the');
print('tens to low hundreds of EECU-seconds (not thousands), the fix worked');
print('and it is safe to run Steps 2 below. If it is still very slow or');
print('expensive, tell me the EECU number and runtime and we will investigate');
print('further before committing to a bigger batch.');

// ============================================================
// STEP 2 — full batches, split into 5-year chunks as before. Only run
// these AFTER confirming the smoke test above completed cheaply.
// Comment out (select the lines and press Ctrl+/) if not ready yet.
// ============================================================

function buildFeatureCollection(startYear, endYear) {
  var yearList = [];
  for (var yr = startYear; yr <= endYear; yr++) {
    yearList.push(String(yr));
  }
  var features = yearList.map(function(year) {
    return getYearStats(year);
  });
  return ee.FeatureCollection(features);
}

var fcPart1 = buildFeatureCollection(2016, 2020);
var fcPart2 = buildFeatureCollection(2021, 2025);

Export.table.toDrive({
  collection: fcPart1,
  description: 'Sehore_Water_NDVI_TimeSeries_2016_2020',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

Export.table.toDrive({
  collection: fcPart2,
  description: 'Sehore_Water_NDVI_TimeSeries_2021_2025',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

print('----- FULL BATCH TASKS ALSO QUEUED (2016-2020, 2021-2025) -----');
print('Do NOT run these yet — run the smoke test above first and confirm');
print('it finishes quickly and cheaply, THEN come back to the Tasks tab');
print('and run these two.');
