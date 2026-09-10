import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors } from "@/src/theme";
import { ALWAR_LANDMARKS, Landmark, haversineKm, ALWAR_CENTER } from "@/src/data/landmarks";
import { AlwarMap } from "@/src/components/AlwarMap";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { searchPlaces, fetchRoute, Place, DirectionsResult } from "@/src/api/mapbox";
import { PhonePrompt } from "@/src/components/PhonePrompt";

type Vehicle = "Nafis Bike" | "Nafis Auto";

export default function RiderHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, setUser } = useAuth();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [drop, setDrop] = useState<Place | null>(null);
  const [focus, setFocus] = useState<"pickup" | "drop" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle>("Nafis Bike");
  const [fareCfg, setFareCfg] = useState({ base_fare: 15, per_km: 8 });
  const [booking, setBooking] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [route, setRoute] = useState<DirectionsResult | null>(null);
  const [rewards, setRewards] = useState<{ credits: number; rides_until_next_reward: number; reward_amount: number; reward_every: number } | null>(null);
  const [useCredits, setUseCredits] = useState(true);
  const searchDebounce = useRef<any>(null);

  useEffect(() => {
    api<{ base_fare: number; per_km: number }>("/config/fare")
      .then(setFareCfg)
      .catch(() => {});
    api<any>("/rewards/me").then(setRewards).catch(() => {});
  }, []);

  // Landmark suggestions - Alwar defaults when empty, Mapbox geocoding when typing
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!focus) return;
    const q = query.trim();
    if (!q) {
      setResults(ALWAR_LANDMARKS.slice(0, 8).map((l) => ({
        id: l.name, name: l.name, area: l.area, lat: l.lat, lng: l.lng,
      })));
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      const fromLocal = ALWAR_LANDMARKS
        .filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 3)
        .map((l) => ({ id: `l-${l.name}`, name: l.name, area: l.area, lat: l.lat, lng: l.lng }));
      const remote = await searchPlaces(`${q} Alwar`);
      // merge unique by name+coords
      const seen = new Set<string>();
      const merged: Place[] = [];
      for (const p of [...fromLocal, ...remote]) {
        const k = `${p.name}-${p.lat.toFixed(4)}-${p.lng.toFixed(4)}`;
        if (!seen.has(k)) { seen.add(k); merged.push(p); }
      }
      setResults(merged.slice(0, 10));
      setSearching(false);
    }, 320);
    return () => searchDebounce.current && clearTimeout(searchDebounce.current);
  }, [query, focus]);

  // Fetch real route via Mapbox Directions when both pickup+drop set
  useEffect(() => {
    if (!pickup || !drop) { setRoute(null); return; }
    let cancelled = false;
    (async () => {
      const r = await fetchRoute(pickup, drop);
      if (!cancelled) setRoute(r);
    })();
    return () => { cancelled = true; };
  }, [pickup, drop]);

  const distance = useMemo(() => {
    if (route) return route.distance_km;
    if (!pickup || !drop) return 0;
    return haversineKm(pickup, drop);
  }, [pickup, drop, route]);

  const bikeFare = useMemo(
    () => Math.max(fareCfg.base_fare, Math.round(fareCfg.base_fare + fareCfg.per_km * distance)),
    [distance, fareCfg],
  );
  const autoFare = useMemo(
    () => Math.max(fareCfg.base_fare + 5, Math.round(fareCfg.base_fare + 5 + (fareCfg.per_km + 3) * distance)),
    [distance, fareCfg],
  );

  const selectPlace = (p: Place) => {
    Haptics.selectionAsync().catch(() => {});
    if (focus === "pickup") setPickup(p);
    else if (focus === "drop") setDrop(p);
    setFocus(null);
    setQuery("");
  };

  const bookRide = async () => {
    if (!pickup || !drop) { Alert.alert("Missing", "Please choose pickup and drop."); return; }
    if (!user?.phone) {
      setShowPhone(true);
      return;
    }
    await createRide();
  };

  const createRide = async () => {
    if (!pickup || !drop) return;
    setBooking(true);
    try {
      const fare = vehicle === "Nafis Bike" ? bikeFare : autoFare;
      const res = await api<{ ride: any }>("/rides", {
        method: "POST",
        body: JSON.stringify({
          pickup_address: pickup.name,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          drop_address: drop.name,
          drop: { lat: drop.lat, lng: drop.lng },
          vehicle,
          distance_km: Number(distance.toFixed(2)),
          fare,
          apply_credits: useCredits && (rewards?.credits || 0) > 0,
        }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.push({ pathname: "/ride-status", params: { rideId: res.ride.ride_id } });
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally {
      setBooking(false);
    }
  };

  const savePhone = async (phone: string) => {
    try {
      const res = await api<{ user: any }>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ phone: `+91${phone}` }),
      });
      setUser(res.user);
      setShowPhone(false);
      await createRide();
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    }
  };

  const pins = useMemo(() => {
    const p: any[] = [];
    if (pickup) p.push({ id: "pickup", lat: pickup.lat, lng: pickup.lng, kind: "pickup", label: "Pickup" });
    if (drop) p.push({ id: "drop", lat: drop.lat, lng: drop.lng, kind: "drop", label: "Drop" });
    return p;
  }, [pickup, drop]);

  return (
    <View style={styles.container} testID="rider-home">
      <View style={StyleSheet.absoluteFill}>
        <AlwarMap
          center={ALWAR_CENTER}
          pins={pins}
          route={route ? { coordinates: route.coordinates } : null}
        />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.topBrand}>
          <View style={styles.dot} />
          <Text style={styles.brandText}>Nafis Ride</Text>
        </View>
        <Pressable onPress={signOut} style={styles.iconBtn} testID="rider-signout">
          <Ionicons name="log-out-outline" size={18} color={colors.onSurfaceInverse} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.sheetWrap}
      >
        <View style={styles.sheet} testID="rider-sheet">
          <View style={styles.handle} />
          {focus ? (
            <View style={{ flex: 1, gap: 12 }}>
              <View style={styles.searchRow}>
                <Ionicons name="search" size={18} color={colors.muted} />
                <TextInput
                  testID="landmark-search-input"
                  autoFocus
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${focus} in Alwar`}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                {searching ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : null}
                <Pressable onPress={() => setFocus(null)} hitSlop={12}>
                  <Ionicons name="close" size={20} color={colors.muted} />
                </Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}>
                {results.map((l) => (
                  <Pressable
                    key={l.id}
                    testID={`place-item-${l.name}`}
                    onPress={() => selectPlace(l)}
                    style={({ pressed }) => [styles.landmarkRow, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name="location-outline" size={18} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.landmarkName}>{l.name}</Text>
                      <Text style={styles.landmarkArea} numberOfLines={1}>{l.area || "Alwar, Rajasthan"}</Text>
                    </View>
                  </Pressable>
                ))}
                {!searching && results.length === 0 ? (
                  <Text style={styles.emptyResults}>No matches. Try another landmark.</Text>
                ) : null}
              </ScrollView>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
              <Text style={styles.sheetTitle}>Where to?</Text>

              <Pressable testID="pickup-field" onPress={() => setFocus("pickup")} style={styles.addrRow}>
                <View style={[styles.addrDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.addrText, !pickup && { color: colors.muted }]} numberOfLines={1}>
                  {pickup?.name || "Pickup location"}
                </Text>
              </Pressable>
              <View style={styles.addrDivider} />
              <Pressable testID="drop-field" onPress={() => setFocus("drop")} style={styles.addrRow}>
                <View style={[styles.addrDot, { backgroundColor: colors.error }]} />
                <Text style={[styles.addrText, !drop && { color: colors.muted }]} numberOfLines={1}>
                  {drop?.name || "Drop location"}
                </Text>
              </Pressable>

              {pickup && drop ? (
                <>
                  <Text style={styles.section}>
                    Choose ride • {distance.toFixed(1)} km{route ? ` • ${Math.round(route.duration_min)} min` : ""}
                  </Text>
                  <VehicleCard label="Nafis Bike" icon="bicycle" eta={`${Math.max(2, Math.round((route?.duration_min || distance * 2) / 3))} min`}
                    price={bikeFare} selected={vehicle === "Nafis Bike"}
                    onPress={() => { setVehicle("Nafis Bike"); Haptics.selectionAsync().catch(() => {}); }}
                    testID="vehicle-bike" />
                  <VehicleCard label="Nafis Auto" icon="car-sport" eta={`${Math.max(3, Math.round((route?.duration_min || distance * 2) / 2))} min`}
                    price={autoFare} selected={vehicle === "Nafis Auto"}
                    onPress={() => { setVehicle("Nafis Auto"); Haptics.selectionAsync().catch(() => {}); }}
                    testID="vehicle-auto" />

                  {rewards && rewards.credits > 0 ? (
                    <Pressable
                      testID="use-credits-toggle"
                      onPress={() => setUseCredits((v) => !v)}
                      style={[styles.creditRow, useCredits && styles.creditRowOn]}
                    >
                      <Ionicons name="gift" size={18} color={useCredits ? colors.onBrandPrimary : colors.brandPrimary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.creditText, useCredits && { color: colors.onBrandPrimary }]}>
                          Use ₹{rewards.credits} Nafis credit
                        </Text>
                        <Text style={[styles.creditSub, useCredits && { color: colors.onBrandPrimary, opacity: 0.75 }]}>
                          {useCredits ? "Applied to this ride" : "Tap to apply"}
                        </Text>
                      </View>
                      <View style={[styles.creditCheck, useCredits && { backgroundColor: colors.onBrandPrimary }]}>
                        {useCredits ? <Ionicons name="checkmark" size={14} color={colors.brandPrimary} /> : null}
                      </View>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <View style={styles.emptyPromo}>
                  <Ionicons name="map-outline" size={22} color={colors.brandPrimary} />
                  <Text style={styles.emptyPromoText}>Pick your pickup and drop in Alwar to see live routes & fares.</Text>
                </View>
              )}

              <Pressable
                testID="book-ride-button"
                disabled={!pickup || !drop || booking}
                onPress={bookRide}
                style={({ pressed }) => [
                  styles.cta,
                  (!pickup || !drop) && { opacity: 0.4 },
                  pressed && { opacity: 0.9 },
                ]}
              >
                {booking ? <ActivityIndicator color={colors.onBrandPrimary} />
                  : <Text style={styles.ctaText}>Book {vehicle} • ₹{vehicle === "Nafis Bike" ? bikeFare : autoFare}</Text>}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>

      <PhonePrompt
        visible={showPhone}
        onSubmit={savePhone}
        onSkip={() => setShowPhone(false)}
      />
    </View>
  );
}

function VehicleCard({ label, icon, eta, price, selected, onPress, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.vehicleCard,
        selected && styles.vehicleCardSelected,
        { opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={[styles.vehicleIcon, selected && { backgroundColor: colors.onBrandPrimary }]}>
        <Ionicons name={icon} size={22} color={selected ? colors.brandPrimary : colors.onBrandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.vehicleLabel}>{label}</Text>
        <Text style={styles.vehicleEta}>{eta} away</Text>
      </View>
      <Text style={styles.vehiclePrice}>₹{price}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  topBrand: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  brandText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  iconBtn: {
    backgroundColor: "rgba(0,0,0,0.6)", width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 16, paddingTop: 8, gap: 8,
    maxHeight: "80%",
  },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  sheetTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  addrRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: 12,
  },
  addrDot: { width: 10, height: 10, borderRadius: 5 },
  addrText: { color: colors.onSurface, fontSize: 15, fontWeight: "600", flex: 1 },
  addrDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 34 },
  section: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 12, textTransform: "uppercase", letterSpacing: 0.8 },
  vehicleCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  vehicleCardSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  vehicleIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.surfaceInverse, alignItems: "center", justifyContent: "center",
  },
  vehicleLabel: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  vehicleEta: { color: colors.muted, fontSize: 12 },
  vehiclePrice: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  cta: {
    marginTop: 8, height: 56, borderRadius: 20,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  ctaText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  emptyPromo: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: colors.brandTertiary, padding: 12, borderRadius: 12, marginTop: 8,
  },
  emptyPromoText: { color: colors.onBrandTertiary, flex: 1, fontSize: 13, fontWeight: "600" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12,
  },
  input: { flex: 1, color: colors.onSurface, fontSize: 15, paddingVertical: 12 },
  landmarkRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  landmarkName: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  landmarkArea: { color: colors.muted, fontSize: 12 },
  emptyResults: { color: colors.muted, textAlign: "center", padding: 24 },
  creditRow: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
    borderRadius: 14, backgroundColor: colors.brandTertiary,
    borderWidth: 1, borderColor: colors.brandPrimary,
    marginTop: 4,
  },
  creditRowOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  creditText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 14 },
  creditSub: { color: colors.onBrandTertiary, opacity: 0.7, fontSize: 11 },
  creditCheck: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
});
