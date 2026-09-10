// Mapbox Geocoding + Directions helpers, biased to Alwar, India.
const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string | undefined;
const ALWAR_CENTER = { lat: 27.5647, lng: 76.6116 };

export type Place = {
  id: string;
  name: string;
  area?: string;
  lat: number;
  lng: number;
};

export async function searchPlaces(query: string): Promise<Place[]> {
  if (!TOKEN || !query.trim()) return [];
  const q = encodeURIComponent(query.trim());
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json` +
    `?access_token=${TOKEN}` +
    `&proximity=${ALWAR_CENTER.lng},${ALWAR_CENTER.lat}` +
    `&country=in` +
    `&language=en` +
    `&limit=8` +
    `&types=poi,address,place,locality,neighborhood`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.features || []).map((f: any) => ({
      id: f.id,
      name: f.text || f.place_name,
      area: (f.place_name || "").replace(f.text + ", ", "") || undefined,
      lng: f.center[0],
      lat: f.center[1],
    }));
  } catch {
    return [];
  }
}

export type DirectionsResult = {
  coordinates: [number, number][];
  distance_km: number;
  duration_min: number;
};

export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<DirectionsResult | null> {
  if (!TOKEN) return null;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?access_token=${TOKEN}&geometries=geojson&overview=full`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const r = j.routes?.[0];
    if (!r) return null;
    return {
      coordinates: r.geometry.coordinates,
      distance_km: (r.distance || 0) / 1000,
      duration_min: (r.duration || 0) / 60,
    };
  } catch {
    return null;
  }
}
