# ============================================================
# Extract_Priority1_Coordinates.py
# Run this in the QGIS Python Console (or as a script via the QGIS
# Python Console's "Run Script" button).
#
# Purpose: get real latitude/longitude for the 8 Priority-1 (urgent
# desilting) water bodies, so we can build actual Google Maps links
# for the field visit sheet.
#
# Targets ClusterCSVtoShape.shp since that's the shapefile built
# directly from the health card CSV (Sehore_WaterBody_Health_Card_FINAL.csv)
# via your own ClusterCSVtoShape.py script, so it should already carry
# the same water_body_id values as Prioprety_1.xlsx.
# ============================================================

from qgis.core import QgsProject, QgsCoordinateReferenceSystem, QgsCoordinateTransform
import csv

# ---- CONFIG: adjust this path if ClusterCSVtoShape.shp isn't already
# loaded as a layer in your current QGIS project ----
layer_name = "ClusterCSVtoShape"
layer = QgsProject.instance().mapLayersByName(layer_name)

if not layer:
    print(f"ERROR: Could not find a loaded layer named '{layer_name}'.")
    print("Load D:\\Epics\\sehoreFeatureShape\\ClusterCSVtoShape\\ClusterCSVtoShape.shp")
    print("into QGIS first (drag it into the Layers panel), then re-run this script.")
else:
    layer = layer[0]

    # Print available field names so we can confirm the ID field matches
    field_names = [f.name() for f in layer.fields()]
    print("Fields found in layer:", field_names)

    # Shapefiles truncate field names to 10 characters (DBF format limit),
    # so 'water_body_id' or 'system:index' becomes 'system_ind'. This is
    # GEE's original system:index field, usually zero-padded like
    # '00000000000000000005' — we strip leading zeros to get the plain
    # integer ID (5) that matches Prioprety_1.xlsx.
    candidates = ["system_ind", "water_body", "water_body_id", "system:index"]
    id_field = next((c for c in candidates if c in field_names), None)

    if id_field is None:
        print("ERROR: Could not find a recognizable ID field.")
        print("Check the field list printed above and set id_field manually.")
    else:
        print(f"Using ID field: '{id_field}'")
        target_ids = [5, 13, 14, 34, 36, 33, 44, 43]

        # Set up transform to WGS84 (EPSG:4326) since that's what Google
        # Maps links need, regardless of what CRS the shapefile is stored in
        source_crs = layer.crs()
        dest_crs = QgsCoordinateReferenceSystem("EPSG:4326")
        transform = QgsCoordinateTransform(source_crs, dest_crs, QgsProject.instance())

        results = []
        for feature in layer.getFeatures():
            fid_value = feature[id_field]
            # Handle both integer and zero-padded string ID formats
            try:
                fid_clean = int(str(fid_value).lstrip('0') or '0')
            except ValueError:
                fid_clean = fid_value

            if fid_clean in target_ids:
                geom = feature.geometry()
                centroid = geom.centroid().asPoint()
                centroid_transformed = transform.transform(centroid)
                lat = centroid_transformed.y()
                lon = centroid_transformed.x()
                maps_link = f"https://www.google.com/maps?q={lat:.6f},{lon:.6f}"
                results.append({
                    'water_body_id': fid_clean,
                    'latitude': round(lat, 6),
                    'longitude': round(lon, 6),
                    'google_maps_link': maps_link
                })

        if not results:
            print("ERROR: No matching features found for the target IDs.")
            print("Target IDs were:", target_ids)
            print("Double check id_field is correct and values actually match.")
        else:
            output_path = "D:\\Epics\\Field Visit\\Priority1_Coordinates.csv"
            with open(output_path, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=['water_body_id', 'latitude', 'longitude', 'google_maps_link'])
                writer.writeheader()
                for row in sorted(results, key=lambda r: r['water_body_id']):
                    writer.writerow(row)

            print(f"SUCCESS: Saved {len(results)} coordinates to {output_path}")
            print("Upload this CSV back to Claude to merge into the final field visit sheet.")
