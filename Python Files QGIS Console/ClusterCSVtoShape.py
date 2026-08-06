import json
from qgis.core import QgsVectorLayer, QgsField, QgsGeometry, QgsFeature
from qgis.PyQt.QtCore import QVariant

uri = "file:///D:/Epics/Sehore_WaterBody_Features_for_Clustering.csv?delimiter=,&crs=EPSG:4326"
layer = QgsVectorLayer(uri, "waterbodies", "delimitedtext")

if not layer.isValid():
    print("Layer not loaded")
else:
    fields = layer.fields()
    mem_layer = QgsVectorLayer("Polygon?crs=EPSG:4326", "WaterBodies_Polygons_Fixed", "memory")
    mem_layer.dataProvider().addAttributes(fields)
    mem_layer.updateFields()

    features = []
    success = 0

    for feat in layer.getFeatures():
        geo_str = feat[".geo"]
        try:
            data = json.loads(geo_str)
            coords = data["coordinates"]  # list of rings

            # Helper: convert a ring (list of [lon, lat]) to WKT ring string, ensuring closure
            def ring_to_wkt(ring):
                # Ensure the ring is closed
                if ring[0] != ring[-1]:
                    ring = ring + [ring[0]]
                return "(" + ",".join([f"{pt[0]} {pt[1]}" for pt in ring]) + ")"

            # Build exterior ring
            exterior_wkt = ring_to_wkt(coords[0])
            # Build interior rings (holes)
            interior_parts = []
            for ring in coords[1:]:
                interior_parts.append(ring_to_wkt(ring))
            interior_wkt = ",".join(interior_parts)
            if interior_wkt:
                interior_wkt = "," + interior_wkt

            wkt = f"POLYGON({exterior_wkt}{interior_wkt})"

            geom = QgsGeometry.fromWkt(wkt)
            if geom and geom.isGeosValid():
                new_feat = QgsFeature(mem_layer.fields())
                new_feat.setGeometry(geom)
                for field in fields:
                    new_feat[field.name()] = feat[field.name()]
                features.append(new_feat)
                success += 1
            else:
                # Print the WKT for debugging (first 200 chars)
                print(f"Row {feat.id()}: invalid geometry. WKT: {wkt[:200]}...")
        except Exception as e:
            print(f"Row {feat.id()}: error - {e}")

    mem_layer.dataProvider().addFeatures(features)
    QgsProject.instance().addMapLayer(mem_layer)
    print(f"Added {success} polygons.")