// ============================================================
// SENTINEL-1 SAR — radar-based water detection
// This is the single most valuable addition: Sentinel-2 (optical) is
// physically blind during heavy monsoon cloud cover — exactly the season
// when water bodies are fullest and most dynamic. Sentinel-1 is radar,
// so it sees through clouds regardless of weather. Combining SAR-based
// water detection with our existing NDWI gives a genuinely more complete
// picture across the full year, not just cloud-free windows.
// ============================================================

var sehore = ee.FeatureCollection('projects/uk-forest/assets/sehore_district');
Map.centerObject(sehore, 9);

function getSARWaterForYear(year) {
  var start = year + '-01-01';
  var end = year + '-12-31';
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(sehore)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select('VH')
    .map(function(img) { return img.clip(sehore); });
  // Water surfaces are smooth -> low radar backscatter (dark in VH).
  // A commonly used threshold is around -18 dB; tune per local calibration
  // against our NDWI mask if results look off.
  var vhMean = s1.mean();
  var sarWaterMask = vhMean.lt(-18).rename('SAR_Water');
  return {composite: vhMean, mask: sarWaterMask};
}

var sar2017 = getSARWaterForYear('2017');
var sar2024 = getSARWaterForYear('2024');

Map.addLayer(sar2017.composite, {min: -25, max: 0}, 'SAR VH backscatter 2017');
Map.addLayer(sar2017.mask, {palette: ['white', 'blue']}, 'SAR Water Mask 2017');
Map.addLayer(sar2024.mask, {palette: ['white', 'blue']}, 'SAR Water Mask 2024');

function calcArea(mask, label) {
  var area = mask.multiply(ee.Image.pixelArea()).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: sehore.geometry(),
    scale: 10, maxPixels: 1e9, tileScale: 4
  });
  var bandName = mask.bandNames().get(0);
  print(label + ' SAR-derived water area (sq km):',
    ee.Number(area.get(bandName)).divide(1e6));
}
calcArea(sar2017.mask, '2017');
calcArea(sar2024.mask, '2024');

// Cross-check: how much do the SAR-based and NDWI-based (optical) water
// masks agree? Large disagreement usually means monsoon-season water that
// optical imagery missed due to persistent cloud cover.
print('----- Compare this SAR-based area against your existing NDWI area -----');
print('If SAR area is notably larger, it likely means Sentinel-2 missed monsoon');
print('water extent due to cloud cover — a genuine, citable limitation of');
print('optical-only NDWI approaches that this script directly addresses.');

Export.image.toDrive({
  image: sar2017.mask, description: 'Sehore_SAR_Water_Mask_2017',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});
Export.image.toDrive({
  image: sar2024.mask, description: 'Sehore_SAR_Water_Mask_2024',
  scale: 10, region: sehore.geometry(), maxPixels: 1e9, folder: 'EPICS'
});

print('----- SAR EXPORTS QUEUED -----');
