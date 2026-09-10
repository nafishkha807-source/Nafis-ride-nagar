import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View, Text, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "@/src/theme";

export type MapPin = {
  id?: string;
  lat: number;
  lng: number;
  kind: "pickup" | "drop" | "driver" | "me";
  label?: string;
};

export type Route = {
  coordinates: [number, number][]; // [lng, lat]
};

type Props = {
  center?: { lat: number; lng: number };
  zoom?: number;
  pins?: MapPin[];
  route?: Route | null;
  followFit?: boolean; // auto-fit to pins+route
};

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string | undefined;

function buildHtml(token: string, center: { lat: number; lng: number }, zoom: number) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.5.2/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.5.2/mapbox-gl.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #171717; }
  .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-bottom-left { display: none !important; }
  .pin {
    width: 20px; height: 20px; border-radius: 50%;
    border: 3px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  }
  .pin.pickup { background: #10B981; }
  .pin.drop   { background: #EF4444; }
  .pin.driver { background: #FFCC00; }
  .pin.me     { background: #F5F5F5; }
  .pin-label {
    position: absolute; top: -22px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.75); color:#fff; font: 600 10px system-ui;
    padding: 2px 6px; border-radius: 4px; white-space: nowrap;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  mapboxgl.accessToken = ${JSON.stringify(token)};
  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: [${center.lng}, ${center.lat}],
    zoom: ${zoom},
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
  });
  const markers = new Map();
  let routeSourceAdded = false;

  function post(type, payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload: payload || {} }));
    }
  }

  map.on("load", () => {
    post("ready");
  });

  window.applyPins = function(pins) {
    const nextIds = new Set(pins.map(p => p.id || (p.kind + "-" + p.lat + "-" + p.lng)));
    // remove old
    for (const [id, m] of markers) {
      if (!nextIds.has(id)) { m.remove(); markers.delete(id); }
    }
    for (const p of pins) {
      const id = p.id || (p.kind + "-" + p.lat + "-" + p.lng);
      if (markers.has(id)) {
        markers.get(id).setLngLat([p.lng, p.lat]);
        continue;
      }
      const el = document.createElement("div");
      el.className = "pin " + p.kind;
      if (p.label) {
        const l = document.createElement("div");
        l.className = "pin-label";
        l.textContent = p.label;
        el.appendChild(l);
      }
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      markers.set(id, marker);
    }
  };

  window.applyRoute = function(route) {
    const src = map.getSource("route");
    if (!route || !route.coordinates || route.coordinates.length === 0) {
      if (routeSourceAdded && src) {
        map.removeLayer("route-line");
        map.removeSource("route");
        routeSourceAdded = false;
      }
      return;
    }
    const geojson = { type: "Feature", geometry: { type: "LineString", coordinates: route.coordinates } };
    if (routeSourceAdded && src) {
      src.setData(geojson);
    } else {
      map.addSource("route", { type: "geojson", data: geojson });
      map.addLayer({
        id: "route-line", type: "line", source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFCC00", "line-width": 5, "line-opacity": 0.95 },
      });
      routeSourceAdded = true;
    }
  };

  window.fitBounds = function(pins, route) {
    const coords = [];
    (pins || []).forEach(p => coords.push([p.lng, p.lat]));
    (route && route.coordinates ? route.coordinates : []).forEach(c => coords.push(c));
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: 14, duration: 600 });
      return;
    }
    const b = coords.reduce((acc, c) => acc.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(b, { padding: 60, duration: 700, maxZoom: 15 });
  };

  window.setCenter = function(c, z) {
    map.easeTo({ center: [c.lng, c.lat], zoom: z || map.getZoom(), duration: 500 });
  };
</script>
</body>
</html>`;
}

export function AlwarMap({
  center = { lat: 27.5647, lng: 76.6116 },
  zoom = 12,
  pins = [],
  route = null,
  followFit = true,
}: Props) {
  const ref = useRef<WebView>(null);
  const ready = useRef(false);
  const html = useMemo(
    () => (MAPBOX_TOKEN ? buildHtml(MAPBOX_TOKEN, center, zoom) : ""),
    // center/zoom only used on first mount; we control the map imperatively after
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [MAPBOX_TOKEN],
  );

  const push = (fn: string, arg: any = null, arg2: any = null) => {
    if (!ref.current || !ready.current) return;
    const args = arg2 !== null ? `${JSON.stringify(arg)}, ${JSON.stringify(arg2)}` : JSON.stringify(arg);
    ref.current.injectJavaScript(`try { window.${fn}(${args}); } catch(e){} ; true;`);
  };

  useEffect(() => {
    push("applyPins", pins);
    push("applyRoute", route);
    if (followFit) push("fitBounds", pins, route);
  }, [pins, route, followFit]);

  if (!MAPBOX_TOKEN) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Map unavailable — Mapbox token missing.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        androidHardwareAccelerationDisabled={false}
        style={styles.webview}
        onMessage={(evt) => {
          try {
            const msg = JSON.parse(evt.nativeEvent.data);
            if (msg.type === "ready") {
              ready.current = true;
              // apply initial state
              push("applyPins", pins);
              push("applyRoute", route);
              if (followFit) push("fitBounds", pins, route);
            }
          } catch {}
        }}
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        )}
        startInLoadingState
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#171717" },
  webview: { flex: 1, backgroundColor: "#171717" },
  loading: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center", backgroundColor: "#171717",
  },
  fallback: {
    flex: 1, backgroundColor: "#171717",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  fallbackText: { color: "#A3A3A3", textAlign: "center" },
});
