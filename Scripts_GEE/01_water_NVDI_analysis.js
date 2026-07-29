// ============================================================
// WATER BODY DETECTION (NDWI) — Sehore District, Madhya Pradesh
// Corrected version: adds pixel-level cloud masking (SCL band)
// on top of the scene-level cloud filter.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

// ---- Pixel-level cloud/shadow/cirrus mask using Scene Classification Layer ----
// SCL values: 3 = cloud shadow, 8 = cloud (medium prob), 9 = cloud (high prob),
// 10 = thin cirrus. We remove all four.
function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

function addNDWI(img) {
  var ndwi = img.normalizedDifference(['B3', 'B8']).rename('NDWI');
  return img.addBands(ndwi);
}

function getWaterForYear(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)) // scene-level filter
    .map(maskS2clouds)                                    // pixel-level mask
    .map(function(img) { return img.clip(sehore); });
  return collection.map(addNDWI).select('NDWI').mean();
}

var water2017 = getWaterForYear('2017');
var water2024 = getWaterForYear('2024');
var waterChange = water2024.subtract(water2017);

// ---- Display ----
var ndwiVis = {min: -0.5, max: 0.5, palette: ['red', 'white', 'blue']};
Map.addLayer(water2017, ndwiVis, 'NDWI 2017');
Map.addLayer(water2024, ndwiVis, 'NDWI 2024');

// ---- Water masks (threshold > 0.1) ----
var waterMask2017 = water2017.gt(0.1);
var waterMask2024 = water2024.gt(0.1);
Map.addLayer(waterMask2017, {palette: ['white', '#1A5BFF']}, 'Water 2017 (mask)');
Map.addLayer(waterMask2024, {palette: ['white', '#1A5BFF']}, 'Water 2024 (mask)');
Map.addLayer(waterChange, {min: -0.5, max: 0.5, palette: ['red', 'white', 'green']},
  'Water Change (Green=Increase, Red=Decrease)');

// ---- Area calculation (band-name-agnostic, avoids the 'NDWI' key errors) ----
function calculateWaterArea(maskImage, label) {
  var area = maskImage.multiply(ee.Image.pixelArea())
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: sehore.geometry(),
      scale: 10,
      maxPixels: 1e9,
      tileScale: 4
    });
  var bandName = maskImage.bandNames().get(0);
  var sqKm = ee.Number(area.get(bandName)).divide(1e6);
  print(label + ' water area (sq km):', sqKm);
  return sqKm;
}

var area2017 = calculateWaterArea(waterMask2017, '2017');
var area2024 = calculateWaterArea(waterMask2024, '2024');
print('Change in water area (sq km):', area2024.subtract(area2017));
print('Percent change:', area2024.subtract(area2017).divide(area2017).multiply(100));

// ---- Debug: NDWI min/max (sanity check on cloud masking) ----
print('NDWI 2017 min/max:', water2017.reduceRegion(
  {reducer: ee.Reducer.minMax(), geometry: sehore.geometry(), scale: 10, maxPixels: 1e9, tileScale: 4}));
print('NDWI 2024 min/max:', water2024.reduceRegion(
  {reducer: ee.Reducer.minMax(), geometry: sehore.geometry(), scale: 10, maxPixels: 1e9, tileScale: 4}));

// ---- Raster exports (also included in 05_Raster_Exports.js) ----
Export.image.toDrive({
  image: water2017, description: 'Sehore_Water_NDWI_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: water2024, description: 'Sehore_Water_NDWI_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: waterMask2017, description: 'Sehore_Water_Mask_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: waterMask2024, description: 'Sehore_Water_Mask_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: waterChange, description: 'Sehore_Water_Change_2017_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- WATER ANALYSIS COMPLETE -----');