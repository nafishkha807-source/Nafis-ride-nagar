// Popular landmarks in Alwar, Rajasthan with approximate coordinates
export type Landmark = { name: string; lat: number; lng: number; area?: string };

export const ALWAR_LANDMARKS: Landmark[] = [
  { name: "Alwar Junction Railway Station", lat: 27.5647, lng: 76.6116, area: "Railway Road" },
  { name: "Scheme No 2", lat: 27.5711, lng: 76.6222, area: "Alwar" },
  { name: "Matsya Industrial Area (MIA)", lat: 27.6096, lng: 76.6300, area: "MIA" },
  { name: "Kala Kuan", lat: 27.5735, lng: 76.6218, area: "Alwar" },
  { name: "Vijay Nagar", lat: 27.5510, lng: 76.6289, area: "Alwar" },
  { name: "Bhagat Singh Chauraha", lat: 27.5580, lng: 76.6198, area: "Alwar" },
  { name: "Bala Quila (Alwar Fort)", lat: 27.5680, lng: 76.5988, area: "Alwar" },
  { name: "Company Bagh", lat: 27.5556, lng: 76.6120, area: "Alwar" },
  { name: "Moti Doongri", lat: 27.5620, lng: 76.6110, area: "Alwar" },
  { name: "Sagar Lake", lat: 27.5715, lng: 76.6035, area: "Alwar" },
  { name: "Manu Marg", lat: 27.5568, lng: 76.6221, area: "Alwar" },
  { name: "City Palace", lat: 27.5661, lng: 76.6060, area: "Alwar" },
  { name: "Ashok Talkies", lat: 27.5590, lng: 76.6155, area: "Alwar" },
  { name: "Hope Circus", lat: 27.5602, lng: 76.6151, area: "Alwar" },
  { name: "NEB Sarai", lat: 27.5470, lng: 76.6420, area: "Alwar" },
  { name: "Kashiram Colony", lat: 27.5720, lng: 76.6280, area: "Alwar" },
  { name: "Shivaji Park", lat: 27.5650, lng: 76.6250, area: "Alwar" },
  { name: "Bhiwadi Road Junction", lat: 27.5350, lng: 76.6180, area: "Alwar" },
];

export const ALWAR_CENTER = { lat: 27.5647, lng: 76.6116 };

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
