// ============================================================
// RANDOM FOREST WATER CLASSIFIER — replaces the fixed NDWI > 0.1 threshold
// This is the actual "ML integration" your mentor is asking for: instead of
// a hardcoded rule, we train a classifier on Sentinel-2 bands, using our
// existing NDWI mask as bootstrap/weak training labels (a standard technique
// when hand-labeled ground truth doesn't exist yet).
//
// NOTE: For a stronger version later, replace the bootstrap labels below with
// a small set of manually digitized points (drawn in the GEE map — water vs.
// non-water — using very high-resolution basemap imagery as a visual guide).
// Even 100-150 manually placed points per class meaningfully improves this.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

function getComposite(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  return ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    // FIX: Sentinel-2 changed its internal QA band set partway through
    // processing history (older scenes have QA10/QA20/QA60, newer scenes
    // have MSK_CLASSI_OPAQUE/CIRRUS/SNOW_ICE instead). A single year's
    // collection can contain a mix of both, and .median()/.mean() require
    // every image to have identical bands — hence "Expected a homogeneous
    // image collection" errors. Selecting only the bands we actually need
    // (present with identical names in both versions) immediately after
    // filtering, before any compositing, avoids the mismatch entirely.
    .select(['B2', 'B3', 'B4', 'B8', 'B11', 'SCL'])
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); })
    .median();
}

var composite2024 = getComposite('2024');

// Feature bands for the classifier: raw spectral bands + NDWI + NDVI
var ndwi = composite2024.normalizedDifference(['B3', 'B8']).rename('NDWI');
var ndvi = composite2024.normalizedDifference(['B8', 'B4']).rename('NDVI');
var featureImage = composite2024.select(['B2', 'B3', 'B4', 'B8', 'B11'])
  .addBands(ndwi).addBands(ndvi);

var bands = ['B2', 'B3', 'B4', 'B8', 'B11', 'NDWI', 'NDVI'];

// ---- Bootstrap training labels from the existing NDWI threshold ----
// (Swap this block for manually digitized points when you have them —
// see note at top of file.)
var waterLabel = ndwi.gt(0.1).rename('water'); // 1 = water, 0 = non-water
var labeledImage = featureImage.addBands(waterLabel);

var trainingPoints = labeledImage.stratifiedSample({
  numPoints: 2000,        // total sample points, split across classes
  classBand: 'water',
  region: sehore.geometry(),
  scale: 10,
  seed: 42,
  geometries: true
});

var split = trainingPoints.randomColumn('random', 42);
var trainSet = split.filter(ee.Filter.lt('random', 0.7));
var testSet = split.filter(ee.Filter.gte('random', 0.7));

// ---- Train Random Forest ----
var classifier = ee.Classifier.smileRandomForest(100)
  .train({
    features: trainSet,
    classProperty: 'water',
    inputProperties: bands
  });

var classified = featureImage.classify(classifier).rename('RF_Water');

// ---- FIX (memory/timeout): every separate print()/Map.addLayer() call below
// was independently forcing GEE to rebuild the ENTIRE chain from scratch —
// the full year-long median composite, then classification across ~65 million
// pixels for the whole district — because nothing is cached between separate
// interactive requests in the console. Stacking 5+ of these (2 map layers +
// confusion matrix + accuracy + kappa + 2 area calcs) compounded into the
// "User memory limit exceeded" / "Computation timed out" errors, even though
// training the classifier itself is cheap.
//
// Fix: bundle the confusion matrix / accuracy / kappa / both areas into ONE
// ee.Feature and export it as a SINGLE batch task (same pattern that fixed
// the time-series script earlier) instead of 5 separate interactive prints.
// Map rendering of the full classified district is also skipped by default
// below — see the optional block at the bottom if you want a visual preview.

var testAccuracy = testSet.classify(classifier).errorMatrix('water', 'classification');

function calcAreaValue(mask) {
  var area = mask.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: sehore.geometry(),
    scale: 10, maxPixels: 1e9, tileScale: 4, bestEffort: true
  });
  var bandName = mask.bandNames().get(0);
  return ee.Number(area.get(bandName)).divide(1e6);
}

var summaryFeature = ee.Feature(null, {
  'overall_accuracy': testAccuracy.accuracy(),
  'kappa': testAccuracy.kappa(),
  'rf_classified_area_sqkm': calcAreaValue(classified),
  'simple_threshold_area_sqkm': calcAreaValue(waterLabel)
});
var summaryFC = ee.FeatureCollection([summaryFeature]);

// NOTE: deliberately NOT printing testAccuracy / accuracy / kappa / areas
// directly here — that interactive evaluation is exactly what caused the
// memory/timeout errors. Check the results in the exported CSV instead.

Export.table.toDrive({
  collection: summaryFC,
  description: 'Sehore_RF_Classifier_Accuracy_Summary_2024',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

Export.image.toDrive({
  image: classified, description: 'Sehore_RF_Water_Classification_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- RF CLASSIFIER: TWO EXPORT TASKS QUEUED -----');
print('1) Sehore_RF_Classifier_Accuracy_Summary_2024 (CSV) — confusion matrix');
print('   accuracy, kappa, and both area figures, all in one row.');
print('2) Sehore_RF_Water_Classification_2024 (GeoTIFF) — the classified raster.');
print('Go to the Tasks tab and Run both. Do NOT re-add print() calls on');
print('testAccuracy/classified/waterLabel here — that is what caused the');
print('memory/timeout errors. Read the results from the exported CSV instead.');
print('');
print('----- OPTIONAL: map preview (heavy, run separately if you want it) -----');
print('If you want to SEE the classified layer on the map, run ONLY the two');
print('Map.addLayer lines below as a separate script execution — do not run');
print('them in the same pass as the exports above, to avoid stacking heavy');
print('interactive requests together again.');
// Map.addLayer(classified, {min: 0, max: 1, palette: ['white', 'blue']}, 'RF Water Classification 2024');
// Map.addLayer(waterLabel, {palette: ['white', '#1A5BFF']}, 'Original NDWI Threshold Mask 2024');
