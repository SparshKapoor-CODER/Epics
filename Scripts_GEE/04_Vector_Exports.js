// ============================================================
// VECTOR (SHAPEFILE) EXPORTS — Sehore District, MP
// Consolidates Vector.js + getnewvectors.js + NVDIvectors.js.
// Fixes: every classified band is .toInt() before vectorizing;
// all classified layers use one consistent scale/smoothing
// approach instead of three conflicting versions.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

// ---- 1. LULC (MODIS) ----
var modis = ee.ImageCollection('MODIS/006/MCD12Q1').select('LC_Type1');
var lulc2017 = modis.filterDate('2017-01-01', '2017-12-31').mosaic().clip(sehore);
var lulc2020 = modis.filterDate('2020-01-01', '2020-12-31').mosaic().clip(sehore);
var lulcChange = lulc2017.neq(lulc2020).rename('Changed').toInt();

// ---- 2. Water (NDWI), with cloud masking ----
function addNDWI(img) {
  return img.addBands(img.normalizedDifference(['B3', 'B8']).rename('NDWI'));
}
function getWaterForYear(year) {
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore).filterDate(year + '-01-01', year + '-12-31')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); });
  return collection.map(addNDWI).select('NDWI').mean();
}
var water2017 = getWaterForYear('2017');
var water2024 = getWaterForYear('2024');
var waterChange = water2024.subtract(water2017);

var waterMask2017 = water2017.gt(0.1).rename('Water2017').toInt();
var waterMask2024 = water2024.gt(0.1).rename('Water2024').toInt();

var waterChangeCat = waterChange
  .where(waterChange.lt(-0.1), -1)
  .where(waterChange.gt(0.1), 1)
  .where(waterChange.gte(-0.1).and(waterChange.lte(0.1)), 0)
  .rename('WaterChangeCat')
  .toInt(); // FIX: was missing in original Vector.js

// ---- 3. NDVI, with cloud masking ----
function addNDVI(img) {
  return img.addBands(img.normalizedDifference(['B8', 'B4']).rename('NDVI'));
}
function getNDVIForYear(year) {
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore).filterDate(year + '-01-01', year + '-12-31')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); });
  return collection.map(addNDVI).select('NDVI').mean();
}
var ndvi2017 = getNDVIForYear('2017');
var ndvi2024 = getNDVIForYear('2024');
var ndviChange = ndvi2024.subtract(ndvi2017);

var ndvi2017Class = ndvi2017
  .where(ndvi2017.lt(0.2), 1)
  .where(ndvi2017.gte(0.2).and(ndvi2017.lt(0.4)), 2)
  .where(ndvi2017.gte(0.4), 3)
  .rename('NDVI2017Class').toInt();

var ndvi2024Class = ndvi2024
  .where(ndvi2024.lt(0.2), 1)
  .where(ndvi2024.gte(0.2).and(ndvi2024.lt(0.4)), 2)
  .where(ndvi2024.gte(0.4), 3)
  .rename('NDVI2024Class').toInt();

var ndviChangeCat = ndviChange
  .where(ndviChange.lt(-0.05), -1)
  .where(ndviChange.gt(0.05), 1)
  .where(ndviChange.gte(-0.05).and(ndviChange.lte(0.05)), 0)
  .rename('NDVIChangeCat').toInt(); // FIX: was missing in original Vector.js

// ---- 4. LULC class masks (cropland / forest / urban) ----
var croplandMask = lulc2020.eq(12).or(lulc2020.eq(14)).rename('Cropland').toInt();
var forestMask = lulc2020.eq(1).or(lulc2020.eq(2)).or(lulc2020.eq(3))
  .or(lulc2020.eq(4)).or(lulc2020.eq(5)).rename('Forest').toInt();
var urbanMask = lulc2020.eq(13).rename('Urban').toInt();

// ---- Export helper ----
// smooth=true applies a 5x5 focal-mode pass before vectorizing, which is
// required for the Sentinel-2-resolution classified layers (water/NDVI) to
// avoid the "geometry too complex" export failure seen in the original runs.
// MODIS-resolution layers (500m) don't need it.
function exportVector(image, description, scale, smooth) {
  var toVectorize = image;
  if (smooth) {
    toVectorize = image.focal_mode({kernel: ee.Kernel.square(2.5), iterations: 1});
  }
  var vectors = toVectorize
    .selfMask()
    .reduceToVectors({
      geometry: sehore.geometry(),
      crs: 'EPSG:4326',
      scale: scale,
      geometryType: 'polygon',
      eightConnected: false,
      maxPixels: 1e9,
      tileScale: 4
    });
  Export.table.toDrive({
    collection: vectors,
    description: description,
    fileFormat: 'SHP',
    folder: 'EPICS'
  });
}

// ---- MODIS-scale layers (500m, no smoothing needed) ----
exportVector(lulc2017, 'Sehore_LULC_2017_Vectors', 500, false);
exportVector(lulc2020, 'Sehore_LULC_2020_Vectors', 500, false);
exportVector(lulcChange, 'Sehore_LULC_Change_Vectors', 500, false);
exportVector(croplandMask, 'Sehore_Cropland_2020_Vectors', 500, false);
exportVector(forestMask, 'Sehore_Forest_2020_Vectors', 500, false);
exportVector(urbanMask, 'Sehore_Urban_2020_Vectors', 500, false);

// ---- Sentinel-2-scale water masks (10m, binary, no smoothing needed) ----
exportVector(waterMask2017, 'Sehore_WaterMask_2017_Vectors', 10, false);
exportVector(waterMask2024, 'Sehore_WaterMask_2024_Vectors', 10, false);

// ---- Sentinel-2-scale classified layers (30m + smoothing, matches what
//      actually completed successfully in the original NVDIvectors.js run) ----
exportVector(waterChangeCat, 'Sehore_WaterChange_Categories_Vectors', 30, true);
exportVector(ndvi2017Class, 'Sehore_NDVI2017_Classes_Vectors', 30, true);
exportVector(ndvi2024Class, 'Sehore_NDVI2024_Classes_Vectors', 30, true);
exportVector(ndviChangeCat, 'Sehore_NDVIChange_Categories_Vectors', 30, true);

print('----- ALL VECTOR EXPORT TASKS ADDED -----');
print('Check the "Tasks" tab (top-right) and click "Run" for each export.');
print('MODIS-scale layers: 500m. Water masks: 10m. Classified change/class layers: 30m + smoothing.');