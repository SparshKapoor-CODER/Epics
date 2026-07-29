// ============================================================
// LULC STATISTICS (MODIS MCD12Q1) — Sehore District, MP
// NEW SCRIPT — the original LULC_Statistics.js was a duplicate
// of the water/NDWI script and never computed LULC stats at all.
//
// Aggregates IGBP LC_Type1 classes into the categories used in
// your report table: Croplands, Forest, Grass/Savannas, Urban,
// Wetlands, Barren. Groupings match the class masks already used
// in Vector.js (cropland = 12,14 | forest = 1-5 | urban = 13).
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

var modis = ee.ImageCollection('MODIS/006/MCD12Q1').select('LC_Type1');

var lulc2017 = modis.filterDate('2017-01-01', '2017-12-31').mosaic().clip(sehore);
var lulc2020 = modis.filterDate('2020-01-01', '2020-12-31').mosaic().clip(sehore);

// ---- Remap IGBP classes (1-17) into 7 report categories ----
// 1-5   -> 1 Forest
// 6-10  -> 2 Grass/Savannas
// 11    -> 3 Wetlands
// 12,14 -> 4 Croplands
// 13    -> 5 Urban
// 15    -> 6 Snow/Ice
// 16    -> 7 Barren
// 17    -> 8 Water Bodies
var fromClasses = [1,2,3,4,5, 6,7,8,9,10, 11, 12,14, 13, 15, 16, 17];
var toClasses   = [1,1,1,1,1, 2,2,2,2,2,  3,  4, 4,  5,  6,  7,  8];

var categoryNames = {
  1: 'Forest', 2: 'Grass/Savannas', 3: 'Wetlands', 4: 'Croplands',
  5: 'Urban', 6: 'Snow/Ice', 7: 'Barren', 8: 'Water Bodies'
};

var lulc2017Agg = lulc2017.remap(fromClasses, toClasses).rename('Category');
var lulc2020Agg = lulc2020.remap(fromClasses, toClasses).rename('Category');

Map.addLayer(lulc2017Agg, {min: 1, max: 8, palette:
  ['358221','A7D282','D6EFFF','FFC34A','F096FF','FFFFFF','DCDCDC','1A5BFF']}, 'LULC Categories 2017');
Map.addLayer(lulc2020Agg, {min: 1, max: 8, palette:
  ['358221','A7D282','D6EFFF','FFC34A','F096FF','FFFFFF','DCDCDC','1A5BFF']}, 'LULC Categories 2020');

// ---- Per-class area (km²) via grouped reducer ----
function classAreaStats(image, label) {
  var areaImg = ee.Image.pixelArea().addBands(image);
  var stats = areaImg.reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'category'}),
    geometry: sehore.geometry(),
    scale: 500,
    maxPixels: 1e9,
    tileScale: 4
  });
  var groups = ee.List(stats.get('groups'));
  var withNames = groups.map(function(g) {
    g = ee.Dictionary(g);
    var catNum = g.get('category');
    var areaKm2 = ee.Number(g.get('sum')).divide(1e6);
    return ee.Dictionary({category: catNum, area_km2: areaKm2});
  });
  print('----- LULC Area by Category (' + label + ') -----', withNames);
  return withNames;
}

var stats2017 = classAreaStats(lulc2017Agg, '2017');
var stats2020 = classAreaStats(lulc2020Agg, '2020');

print('Category key:', categoryNames);
print('Total district area (sq km):', sehore.geometry().area().divide(1e6));

// ---- Change hotspots (any class change 2017->2020, on aggregated categories) ----
var change = lulc2017Agg.neq(lulc2020Agg).rename('Changed');
Map.addLayer(change, {min: 0, max: 1, palette: ['white', 'red']}, 'LULC Change Hotspots');

var changedAreaKm2 = change.selfMask().multiply(ee.Image.pixelArea())
  .reduceRegion({
    reducer: ee.Reducer.sum(), geometry: sehore.geometry(),
    scale: 500, maxPixels: 1e9, tileScale: 4
  });
print('Total changed area 2017->2020 (sq km):',
  ee.Number(changedAreaKm2.get('Changed')).divide(1e6));

// ---- Raster exports ----
Export.image.toDrive({
  image: lulc2017, description: 'Sehore_LULC_2017',
  scale: 500, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: lulc2020, description: 'Sehore_LULC_2020',
  scale: 500, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: change, description: 'Sehore_LULC_Change_2017_2020',
  scale: 500, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- LULC STATISTICS COMPLETE -----');
print('Copy the printed area_km2 values into your report table (this replaces');
print('any manually-derived LULC figures — verify against them).');