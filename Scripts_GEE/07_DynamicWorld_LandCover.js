// ============================================================
// DYNAMIC WORLD — 10m near-real-time land cover (Google/WRI/NGIS)
// This is already an ML product: a deep neural network trained on
// Sentinel-2, updated per scene. Using it replaces our current
// 500m MODIS LULC with genuine 10m resolution, and it's a legitimate
// "we integrated an existing ML model" citation for the report.
// Dataset: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

var dwClassNames = ['water', 'trees', 'grass', 'flooded_vegetation', 'crops',
                     'shrub_and_scrub', 'built', 'bare', 'snow_and_ice'];
var dwPalette = ['419BDF', '397D49', '88B053', '7A87C6', 'E49635',
                  'DFC35A', 'C4281B', 'A59B8F', 'B39FE1'];

// ---- Simple color legend, printed once at the top so it's the first
// thing visible in the console — plain-language names and what each
// class actually means on the ground, no jargon. ----
var dwLegend = [
  '0 = water            -> Color: BLUE            -> Rivers, ponds, lakes, reservoirs',
  '1 = trees             -> Color: DARK GREEN      -> Forests, dense tree cover',
  '2 = grass             -> Color: LIGHT GREEN     -> Open grassland, natural grass cover',
  '3 = flooded_vegetation-> Color: PURPLE          -> Wetlands, marshy/waterlogged plants',
  '4 = crops             -> Color: ORANGE          -> Farmland, agricultural fields',
  '5 = shrub_and_scrub   -> Color: YELLOW/GOLD     -> Bushes, scrubland, sparse dry vegetation',
  '6 = built              -> Color: RED             -> Buildings, roads, towns, urban areas',
  '7 = bare               -> Color: GREY/BROWN      -> Bare soil, rock, sand — no vegetation',
  '8 = snow_and_ice       -> Color: LIGHT PURPLE    -> Snow/ice (not expected in Sehore district)'
];
print('===== DYNAMIC WORLD COLOR LEGEND (what each color on the map means) =====');
dwLegend.forEach(function(line) { print(line); });
print('===========================================================================');

function getDynamicWorldComposite(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(sehore)
    .filterDate(start, end)
    .select('label'); // 'label' = most-likely class per pixel
  // Mode composite for the year (most frequently predicted class per pixel)
  return dw.mode().clip(sehore).rename('dw_class').set('year', year);
}

var dw2017 = getDynamicWorldComposite('2017');
var dw2024 = getDynamicWorldComposite('2024');

Map.addLayer(dw2017, {min: 0, max: 8, palette: dwPalette}, 'Dynamic World 2017 (10m)');
Map.addLayer(dw2024, {min: 0, max: 8, palette: dwPalette}, 'Dynamic World 2024 (10m)');

// Per-class area (km²) — same grouped-reducer pattern as 03_LULC_Statistics.js,
// but now at 10m instead of 500m.
function classAreaStats(image, label) {
  var areaImg = ee.Image.pixelArea().addBands(image);
  var stats = areaImg.reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'class'}),
    geometry: sehore.geometry(),
    scale: 10,
    maxPixels: 1e9,
    tileScale: 4
  });
  print('----- Dynamic World Area by Class (' + label + ', 10m) -----',
    ee.List(stats.get('groups')));
  print('(Match the "class" number above against the color legend printed at the top');
  print('of the console to see which color/land-cover type each number means.)');
}

classAreaStats(dw2017, '2017');
classAreaStats(dw2024, '2024');
print('Class index key:', dwClassNames);

Export.image.toDrive({
  image: dw2017, description: 'Sehore_DynamicWorld_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: dw2024, description: 'Sehore_DynamicWorld_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- DYNAMIC WORLD EXPORT QUEUED -----');
