// ============================================================
// RAINFALL (CHIRPS) + ELEVATION (SRTM DEM)
// Two purposes:
// 1. CHIRPS lets us check whether water-body decline correlates with
//    reduced rainfall (natural cause) vs. being independent of rainfall
//    (siltation/diversion/human cause) — important for choosing the
//    right revival strategy per hotspot.
// 2. SRTM DEM lets us delineate an actual catchment boundary per water
//    body (via flow accumulation) instead of using a fixed-radius buffer,
//    which is what our current "surrounding NDVI" analysis effectively
//    assumes.
//
// FIX: same bug class as the time-series script — years are looped
// client-side (plain JS array) instead of via ee.List.sequence().map(),
// which was feeding a server-side ee.String into JS string concatenation
// and producing "Bad date/time" errors.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

// ---- 1. CHIRPS annual rainfall time series ----
function getAnnualRainfall(year) {
  // 'year' is always a plain JS string here, e.g. "2017".
  var start = year + '-01-01';
  var end = year + '-12-31';
  var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
    .filterBounds(sehore)
    .filterDate(start, end)
    .sum() // sum of daily rainfall = total annual rainfall
    .clip(sehore);
  var meanRain = chirps.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: sehore.geometry(),
    scale: 5000, maxPixels: 1e9, tileScale: 4
  }).get('precipitation');
  return ee.Feature(null, {
    'year': parseInt(year, 10),
    'mean_annual_rainfall_mm': meanRain
  });
}

// Plain client-side year list — NOT ee.List.sequence().
var rainYearList = [];
for (var yr = 2016; yr <= 2025; yr++) {
  rainYearList.push(String(yr));
}

// Plain JS Array.prototype.map (client-side), so 'year' stays a real
// JS string all the way through — same fix as the time-series script.
var rainfallFeatures = rainYearList.map(function(year) {
  return getAnnualRainfall(year);
});

var rainfallFC = ee.FeatureCollection(rainfallFeatures);
print('Feature count queued (should be 10):', rainfallFC.size());
// NOTE: intentionally not calling ui.Chart or a full print() on rainfallFC
// here — same reasoning as 06_TimeSeries_2016_2025.js. Preview the trend
// from the exported CSV instead, after the export task completes.

Export.table.toDrive({
  collection: rainfallFC,
  description: 'Sehore_Annual_Rainfall_2016_2025',
  fileFormat: 'CSV',
  folder: 'EPICS'
});

// ---- 2. SRTM DEM + derived flow accumulation for catchment delineation ----
var srtm = ee.Image('USGS/SRTMGL1_003').clip(sehore);
Map.addLayer(srtm, {min: 250, max: 650, palette: ['blue', 'green', 'yellow', 'brown', 'white']},
  'SRTM Elevation (30m)');

var slope = ee.Terrain.slope(srtm);
Map.addLayer(slope, {min: 0, max: 30, palette: ['white', 'red']}, 'Slope (degrees)');

// Flow direction / accumulation requires the hydrology package.
// Simpler alternative available in GEE without extra packages: use the
// HydroSHEDS flow accumulation product directly (precomputed, global, free).
var flowAcc = ee.Image('WWF/HydroSHEDS/15ACC').clip(sehore);
Map.addLayer(flowAcc, {min: 0, max: 5000, palette: ['white', 'blue', 'darkblue']},
  'Flow Accumulation (HydroSHEDS, ~500m)');

Export.image.toDrive({
  image: srtm, description: 'Sehore_SRTM_DEM',
  scale: 30, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: flowAcc, description: 'Sehore_FlowAccumulation_HydroSHEDS',
  scale: 450, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- RAINFALL + DEM EXPORTS QUEUED -----');
print('Use flow accumulation + DEM in QGIS (r.watershed or similar) to delineate');
print('an actual catchment boundary per priority water body, replacing a fixed buffer.');
