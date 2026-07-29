// ============================================================
// NDVI (VEGETATION HEALTH) ANALYSIS — Sehore District, MP
// Corrected version: adds pixel-level cloud masking (SCL band).
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

// ---- Pixel-level cloud/shadow/cirrus mask (same as water script, kept consistent) ----
function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

function addNDVI(img) {
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return img.addBands(ndvi);
}

function getNDVIForYear(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .map(maskS2clouds)
    .map(function(img) { return img.clip(sehore); });
  return collection.map(addNDVI).select('NDVI').mean();
}

var ndvi2017 = getNDVIForYear('2017');
var ndvi2024 = getNDVIForYear('2024');
var ndviChange = ndvi2024.subtract(ndvi2017);

// ---- Display ----
var ndviVis = {min: -0.5, max: 0.8, palette: ['brown', 'yellow', 'green']};
Map.addLayer(ndvi2017, ndviVis, 'NDVI 2017');
Map.addLayer(ndvi2024, ndviVis, 'NDVI 2024');
Map.addLayer(ndviChange, {min: -0.5, max: 0.5, palette: ['red', 'white', 'green']},
  'NDVI Change (Green=Increase, Red=Decrease)');

// ---- Mean / min / max stats ----
var meanNDVI2017 = ndvi2017.reduceRegion(
  {reducer: ee.Reducer.mean(), geometry: sehore.geometry(), scale: 10, maxPixels: 1e9, tileScale: 4});
var meanNDVI2024 = ndvi2024.reduceRegion(
  {reducer: ee.Reducer.mean(), geometry: sehore.geometry(), scale: 10, maxPixels: 1e9, tileScale: 4});
var minMax2017 = ndvi2017.reduceRegion(
  {reducer: ee.Reducer.minMax(), geometry: sehore.geometry(), scale: 10, maxPixels: 1e9, tileScale: 4});
var minMax2024 = ndvi2024.reduceRegion(
  {reducer: ee.Reducer.minMax(), geometry: sehore.geometry(), scale: 10, maxPixels: 1e9, tileScale: 4});

print('----- NDVI RESULTS -----');
print('Mean NDVI 2017:', meanNDVI2017.get('NDVI'));
print('Mean NDVI 2024:', meanNDVI2024.get('NDVI'));
print('NDVI Change (2024 - 2017):',
  ee.Number(meanNDVI2024.get('NDVI')).subtract(ee.Number(meanNDVI2017.get('NDVI'))));
print('NDVI 2017 - Min:', minMax2017.get('NDVI_min'));
print('NDVI 2017 - Max:', minMax2017.get('NDVI_max'));
print('NDVI 2024 - Min:', minMax2024.get('NDVI_min'));
print('NDVI 2024 - Max:', minMax2024.get('NDVI_max'));

// ---- Classification (consistent 3-class scheme used everywhere else in the
//      pipeline: <0.2 sparse, 0.2-0.4 moderate, >=0.4 dense). The old
//      NDVI_Analysis.js used a different 4-class scheme (with a <0 "no
//      vegetation" bucket) that didn't match the vector export scripts —
//      standardized here to match 04_Vector_Exports.js. ----
var ndvi2017Class = ndvi2017
  .where(ndvi2017.lt(0.2), 1)
  .where(ndvi2017.gte(0.2).and(ndvi2017.lt(0.4)), 2)
  .where(ndvi2017.gte(0.4), 3)
  .rename('NDVI2017Class')
  .toInt();

var ndvi2024Class = ndvi2024
  .where(ndvi2024.lt(0.2), 1)
  .where(ndvi2024.gte(0.2).and(ndvi2024.lt(0.4)), 2)
  .where(ndvi2024.gte(0.4), 3)
  .rename('NDVI2024Class')
  .toInt();

var classPalette = ['#FFC34A', '#A7D282', '#358221']; // sparse -> moderate -> dense
Map.addLayer(ndvi2024Class, {min: 1, max: 3, palette: classPalette}, 'Vegetation Classes 2024');

// ---- Raster exports (also included in 05_Raster_Exports.js) ----
Export.image.toDrive({
  image: ndvi2017, description: 'Sehore_NDVI_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: ndvi2024, description: 'Sehore_NDVI_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: ndviChange, description: 'Sehore_NDVI_Change_2017_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- NDVI ANALYSIS COMPLETE -----');