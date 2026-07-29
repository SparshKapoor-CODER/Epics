// ============================================================
// RASTER (GeoTIFF) EXPORTS FOR QGIS — Sehore District, MP
// Replaces Combined_Map.js. Same 11 layers, now with real
// pixel-level cloud masking (SCL) instead of scene filter alone.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

function maskS2clouds(img) {
  var scl = img.select('SCL');
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return img.updateMask(mask);
}

// ---- LULC (MODIS) ----
var modis = ee.ImageCollection('MODIS/006/MCD12Q1').select('LC_Type1');
var lulc2017 = modis.filterDate('2017-01-01', '2017-12-31').mosaic().clip(sehore);
var lulc2020 = modis.filterDate('2020-01-01', '2020-12-31').mosaic().clip(sehore);
var lulcChange = lulc2017.neq(lulc2020);

// ---- Water (NDWI) ----
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
var waterMask2017 = water2017.gt(0.1);
var waterMask2024 = water2024.gt(0.1);

// ---- NDVI ----
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

// ---- Exports (11 layers, unchanged naming from Combined_Map.js) ----
Export.image.toDrive({image: lulc2017, description: 'Sehore_LULC_2017',
  scale: 500, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: lulc2020, description: 'Sehore_LULC_2020',
  scale: 500, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: lulcChange, description: 'Sehore_LULC_Change_2017_2020',
  scale: 500, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: water2017, description: 'Sehore_Water_NDWI_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: water2024, description: 'Sehore_Water_NDWI_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: waterMask2017, description: 'Sehore_Water_Mask_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: waterMask2024, description: 'Sehore_Water_Mask_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: waterChange, description: 'Sehore_Water_Change_2017_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: ndvi2017, description: 'Sehore_NDVI_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: ndvi2024, description: 'Sehore_NDVI_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});
Export.image.toDrive({image: ndviChange, description: 'Sehore_NDVI_Change_2017_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS_Rasters'});

print('----- EXPORT INITIATED -----');
print('Check "Tasks" tab (top-right) and click "Run" for each export');
print('All files will be saved to Google Drive in the "EPICS_Rasters" folder');
print('NOTE: values will differ slightly from your original exports because');
print('pixel-level cloud masking (SCL) is now applied — re-run the report');
print('numbers (water area, NDVI mean) against 01_Water_NDWI_Analysis.js and');
print('02_NDVI_Analysis.js before finalizing the health card.');
