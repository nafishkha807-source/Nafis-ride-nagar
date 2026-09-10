import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";
import { AlwarMap } from "@/src/components/AlwarMap";
import { api } from "@/src/api/client";
import { fetchRoute, DirectionsResult } from "@/src/api/mapbox";
import { RideReceipt } from "@/src/components/RideReceipt";
import { CancelReasonSheet } from "@/src/components/CancelReasonSheet";
import { RideChat } from "@/src/components/RideChat";

export default function RideStatus() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [ride, setRide] = useState<any | null>(null);
  const [route, setRoute] = useState<DirectionsResult | null>(null);
  const [receiptShown, setReceiptShown] = useState(false);
  const [cancelSheet, setCancelSheet] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const pollRef = useRef<any>(null);

  const load = async () => {
    try {
      const res = await api<{ ride: any }>(`/rides/${rideId}`);
      setRide(res.ride);
    } catch {}
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 2000);
    return () => clearInterval(pollRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  useEffect(() => {
    if (!ride?.pickup || !ride?.drop) return;
    let cancelled = false;
    (async () => {
      const r = await fetchRoute(ride.pickup, ride.drop);
      if (!cancelled) setRoute(r);
    })();
    return () => { cancelled = true; };
  }, [ride?.pickup?.lat, ride?.pickup?.lng, ride?.drop?.lat, ride?.drop?.lng]);

  // auto-show receipt when ride completes
  useEffect(() => {
    if (ride?.status === "COMPLETED" && !receiptShown) {
      setReceiptShown(true);
    }
  }, [ride?.status, receiptShown]);

  const status = ride?.status || "REQUESTED";

  const heading =
    status === "REQUESTED" ? "Searching for Captain…" :
    status === "ACCEPTED" ? "Captain is on the way" :
    status === "ARRIVING" ? "Captain Arriving" :
    status === "IN_PROGRESS" ? "Enjoy your ride" :
    status === "COMPLETED" ? "Ride Completed" :
    "Ride Cancelled";

  const sub =
    status === "REQUESTED" ? "Notifying nearby captains around you" :
    status === "ACCEPTED" ? "Your captain has accepted the request" :
    status === "ARRIVING" ? "Look out for your captain nearby" :
    status === "IN_PROGRESS" ? "You're on your way to the destination" :
    status === "COMPLETED" ? "Thank you for riding with Nafis Ride" :
    "";

  const cancel = async (reason?: string) => {
    try {
      await api(`/rides/${rideId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "CANCELLED", reason }),
      });
      setCancelSheet(false);
      router.back();
    } catch {}
  };

  const pins: any[] = [];
  if (ride) {
    pins.push({ id: "pickup", lat: ride.pickup?.lat, lng: ride.pickup?.lng, kind: "pickup", label: "Pickup" });
    pins.push({ id: "drop", lat: ride.drop?.lat, lng: ride.drop?.lng, kind: "drop", label: "Drop" });
    if (ride.captain_location?.lat && ride.captain_location?.lng) {
      pins.push({
        id: "captain",
        lat: ride.captain_location.lat,
        lng: ride.captain_location.lng,
        kind: "driver",
        label: "Captain",
      });
    }
  }

  return (
    <View style={styles.container} testID="ride-status-screen">
      <View style={StyleSheet.absoluteFill}>
        <AlwarMap pins={pins} route={route ? { coordinates: route.coordinates } : null} />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="ride-back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurfaceInverse} />
        </Pressable>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{status}</Text>
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.rowTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>{heading}</Text>
            {sub ? <Text style={styles.h2}>{sub}</Text> : null}
          </View>
          {status === "REQUESTED" ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : null}
        </View>

        {ride?.captain_name ? (
          <View style={styles.driver}>
            <View style={styles.driverAvatar}>
              <Ionicons name="person" size={22} color={colors.onBrandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{ride.captain_name}</Text>
              <Text style={styles.driverPlate}>{ride.vehicle} • {ride.captain_vehicle_number || "RJ 02 —"}</Text>
            </View>
            {status !== "COMPLETED" && status !== "CANCELLED" ? (
              <Pressable testID="open-chat-button" onPress={() => setChatOpen(true)} style={styles.chatBtn}>
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.onBrandPrimary} />
              </Pressable>
            ) : (
              <View style={styles.rating}>
                <Ionicons name="star" size={12} color={colors.brandPrimary} />
                <Text style={styles.ratingText}>4.9</Text>
              </View>
            )}
          </View>
        ) : null}

        <View style={styles.route}>
          <View style={styles.rrow}>
            <View style={[styles.rdot, { backgroundColor: colors.success }]} />
            <Text style={styles.rtext} numberOfLines={1}>{ride?.pickup_address || "—"}</Text>
          </View>
          <View style={styles.rline} />
          <View style={styles.rrow}>
            <View style={[styles.rdot, { backgroundColor: colors.error }]} />
            <Text style={styles.rtext} numberOfLines={1}>{ride?.drop_address || "—"}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Meta label="Distance" value={`${ride?.distance_km?.toFixed(1) || "0"} km`} />
          <Meta label="Vehicle" value={ride?.vehicle || "—"} />
          <Meta label="Fare" value={`₹${ride?.fare || 0}`} />
        </View>

        {status === "REQUESTED" || status === "ACCEPTED" || status === "ARRIVING" ? (
          <Pressable testID="cancel-ride-button" onPress={() => setCancelSheet(true)} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel Ride</Text>
          </Pressable>
        ) : status === "COMPLETED" ? (
          <Pressable testID="view-receipt-button" onPress={() => setReceiptShown(true)} style={styles.done}>
            <Text style={styles.doneText}>View Receipt</Text>
          </Pressable>
        ) : null}
      </View>

      <RideReceipt
        visible={receiptShown && ride?.status === "COMPLETED"}
        ride={ride}
        onClose={() => { setReceiptShown(false); router.replace("/(rider)"); }}
      />

      <CancelReasonSheet
        visible={cancelSheet}
        onCancel={() => setCancelSheet(false)}
        onConfirm={(reason) => cancel(reason)}
      />

      <RideChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        rideId={String(rideId)}
        myRole="rider"
      />
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  iconBtn: {
    backgroundColor: "rgba(0,0,0,0.6)", width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  chip: { backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11, letterSpacing: 0.8 },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 16, gap: 10,
  },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  rowTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  h1: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  h2: { color: colors.muted, fontSize: 13, marginTop: 2 },
  driver: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surfaceSecondary, padding: 12, borderRadius: 16,
  },
  driverAvatar: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  driverName: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  driverPlate: { color: colors.muted, fontSize: 12 },
  rating: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandTertiary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  ratingText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 12 },
  chatBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  route: { backgroundColor: colors.surfaceSecondary, padding: 12, borderRadius: 16, gap: 8 },
  rrow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rdot: { width: 10, height: 10, borderRadius: 5 },
  rtext: { color: colors.onSurface, fontSize: 14, flex: 1, fontWeight: "600" },
  rline: { width: 2, height: 10, backgroundColor: colors.border, marginLeft: 4 },
  metaRow: { flexDirection: "row", gap: 8 },
  metaCell: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: "center" },
  metaLabel: { color: colors.muted, fontSize: 11 },
  metaValue: { color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  cancel: {
    height: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.error,
    alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  cancelText: { color: colors.error, fontWeight: "700" },
  done: {
    height: 52, borderRadius: 16, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  doneText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
});
