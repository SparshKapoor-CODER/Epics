// ============================================================
// INDEPENDENT VALIDATION — RF Classifier vs. Simple NDWI Threshold
// ============================================================
//
// ⚠️ READ THIS BEFORE RUNNING — DO THESE STEPS IN THIS EXACT ORDER ⚠️
//
// STEP 1: Paste this entire script into a NEW, empty script tab in the
//         GEE Code Editor. Do NOT run it yet.
//
// STEP 2: With this script still sitting in the editor (do not clear it),
//         use the Geometry drawing tools ABOVE THE MAP (top-left icons):
//           a) Click the point/marker tool.
//           b) Click the gear icon on the new layer -> set
//              "Import as: FeatureCollection" -> add a property named
//              exactly: class
//           c) Click ~75-100 spots on the satellite basemap that are
//              CLEARLY water (middle of ponds/tanks/rivers, not fuzzy
//              edges). Set property class = 1 for all of them.
//              Rename this layer to: waterPoints
//           d) Click "+ new layer", repeat for ~75-100 spots that are
//              CLEARLY NOT water (mix of cropland, bare soil, forest,
//              built-up — not just one type). Set class = 0.
//              Rename this layer to: nonWaterPoints
//
//         GEE will automatically insert two lines at the very TOP of this
//         script (above everything else), looking like:
//           var waterPoints = /* color: #.. */ee.FeatureCollection([...]);
//           var nonWaterPoints = /* color: #.. */ee.FeatureCollection([...]);
//         This happens automatically — you do not type these yourself.
//         Drawing points ADDS to the top of the script; it will NOT erase
//         the code below, as long as you don't paste over the whole editor
//         again after drawing.
//
// STEP 3: Only after you see those two var lines actually sitting at the
//         top of your script (scroll up to check!), click Run.
//
// If you get "waterPoints is not defined", it means Step 2 wasn't done in
// THIS tab, or the editor content got overwritten after drawing. Redo
// Step 1-2 in a single continuous session without re-pasting.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

// ---- Safety check: keep ONLY points that actually fall inside Sehore ----
function keepInsideSehore(fc, label) {
  var filtered = fc.filterBounds(sehore);
  print(label + ' — points drawn:', fc.size(),
        '| points confirmed inside Sehore:', filtered.size());
  return filtered;
}

var waterPointsChecked = keepInsideSehore(waterPoints, 'waterPoints');
var nonWaterPointsChecked = keepInsideSehore(nonWaterPoints, 'nonWaterPoints');
var groundTruth = waterPointsChecked.merge(nonWaterPointsChecked);

// ============================================================
// Rebuild the same composite / classifier / threshold as
// 10_RandomForest_Water_Classifier.js
// ============================================================

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
    .select(['B2', 'B3', 'B4', 'B8', 'B11', 'SCL'])
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); })
    .median();
}

var composite2024 = getComposite('2024');
var ndwi = composite2024.normalizedDifference(['B3', 'B8']).rename('NDWI');
var ndvi = composite2024.normalizedDifference(['B8', 'B4']).rename('NDVI');
var featureImage = composite2024.select(['B2', 'B3', 'B4', 'B8', 'B11'])
  .addBands(ndwi).addBands(ndvi);
var bands = ['B2', 'B3', 'B4', 'B8', 'B11', 'NDWI', 'NDVI'];

// Generate training points from NDWI threshold (bootstrap labels) – never use groundTruth.
var waterLabelBootstrap = ndwi.gt(0.1).rename('water');
var labeledImage = featureImage.addBands(waterLabelBootstrap);
var trainingPoints = labeledImage.stratifiedSample({
  numPoints: 2000,
  classBand: 'water',
  region: sehore.geometry(),
  scale: 10,
  seed: 42,
  geometries: true
});

// ---- Train Random Forest ----
var classifier = ee.Classifier.smileRandomForest(100)
  .train({
    features: trainingPoints,
    classProperty: 'water',
    inputProperties: bands
  });

var rfClassified = featureImage.classify(classifier).rename('RF_Water');
var thresholdClassified = ndwi.gt(0.1).rename('Threshold_Water');

// ============================================================
// INDEPENDENT VALIDATION – sample at your manually labeled points
// ============================================================

var rfSampled = rfClassified.sampleRegions({
  collection: groundTruth,
  properties: ['class'],
  scale: 10
});
var thresholdSampled = thresholdClassified.sampleRegions({
  collection: groundTruth,
  properties: ['class'],
  scale: 10
});

var rfMatrix = rfSampled.errorMatrix('class', 'RF_Water');
var thresholdMatrix = thresholdSampled.errorMatrix('class', 'Threshold_Water');

var validationSummary = ee.Feature(null, {
  'ground_truth_points_used': groundTruth.size(),
  'rf_accuracy_independent': rfMatrix.accuracy(),
  'rf_kappa_independent': rfMatrix.kappa(),
  'threshold_accuracy_independent': thresholdMatrix.accuracy(),
  'threshold_kappa_independent': thresholdMatrix.kappa()
});

Export.table.toDrive({
  collection: ee.FeatureCollection([validationSummary]),
  description: 'Sehore_Independent_Validation_RF_vs_Threshold',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

print('----- INDEPENDENT VALIDATION EXPORT QUEUED -----');
print('Go to the Tasks tab and click Run.');
print('This CSV gives the real, non‑circular accuracy – the number for your report.');
print('Validation is within Sehore, 2024 only – state that scope explicitly.');