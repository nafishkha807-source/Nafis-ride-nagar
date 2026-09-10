import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Switch, ActivityIndicator, Modal, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { colors } from "@/src/theme";
import { api } from "@/src/api/client";
import { ALWAR_CENTER } from "@/src/data/landmarks";
import { AlwarMap } from "@/src/components/AlwarMap";
import { useAuth } from "@/src/context/AuthContext";

// Simple beep sound URL (default notification-like). Using a small public wav.
const ALERT_SOUND = "https://actions.google.com/sounds/v1/alarms/beep_short.ogg";

export default function CaptainHome() {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const [online, setOnline] = useState<boolean>(!!user?.online);
  const [pendingRide, setPendingRide] = useState<any | null>(null);
  const [seenIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const [earnings, setEarnings] = useState({ today_earnings: 0, today_rides: 0, total_earnings: 0, total_rides: 0, active_rides: 0 });
  const [peak, setPeak] = useState<any>(null);
  const pollRef = useRef<any>(null);
  const locRef = useRef<any>(null);
  const earnRef = useRef<any>(null);
  const peakRef = useRef<any>(null);
  const player = useAudioPlayer({ uri: ALERT_SOUND });

  // location simulator - moves around Alwar center
  const simulateLocation = useCallback(async () => {
    const jitter = () => (Math.random() - 0.5) * 0.02;
    try {
      await api("/driver-locations", {
        method: "POST",
        body: JSON.stringify({
          lat: ALWAR_CENTER.lat + jitter(),
          lng: ALWAR_CENTER.lng + jitter(),
          online: true,
        }),
      });
    } catch {}
  }, []);

  const stopOnline = useCallback(async () => {
    try {
      await api("/driver-locations", {
        method: "POST",
        body: JSON.stringify({ lat: ALWAR_CENTER.lat, lng: ALWAR_CENTER.lng, online: false }),
      });
    } catch {}
  }, []);

  const pollPending = useCallback(async () => {
    try {
      const res = await api<{ rides: any[] }>("/rides/pending");
      const newest = res.rides.find((r) => !seenIds.has(r.ride_id));
      if (newest && !pendingRide) {
        seenIds.add(newest.ride_id);
        setPendingRide(newest);
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          player.seekTo(0);
          player.play();
        } catch {}
      }
    } catch {}
  }, [pendingRide, player, seenIds]);

  const loadEarnings = useCallback(async () => {
    try {
      const res = await api<any>("/captains/me/earnings");
      setEarnings(res);
    } catch {}
  }, []);

  const loadPeak = useCallback(async () => {
    try {
      const res = await api<any>("/peak/now");
      setPeak(res);
    } catch {}
  }, []);

  useEffect(() => { loadEarnings(); loadPeak(); }, [loadEarnings, loadPeak]);

  useEffect(() => {
    peakRef.current = setInterval(loadPeak, 60000);
    return () => peakRef.current && clearInterval(peakRef.current);
  }, [loadPeak]);

  useEffect(() => {
    if (online) {
      simulateLocation();
      pollPending();
      loadEarnings();
      locRef.current = setInterval(simulateLocation, 8000);
      pollRef.current = setInterval(pollPending, 4000);
      earnRef.current = setInterval(loadEarnings, 10000);
    } else {
      stopOnline();
      if (locRef.current) clearInterval(locRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (earnRef.current) clearInterval(earnRef.current);
    }
    return () => {
      if (locRef.current) clearInterval(locRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (earnRef.current) clearInterval(earnRef.current);
    };
  }, [online, simulateLocation, pollPending, stopOnline, loadEarnings]);

  const toggle = (v: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setOnline(v);
  };

  const accept = async () => {
    if (!pendingRide) return;
    setAccepting(true);
    try {
      await api(`/rides/${pendingRide.ride_id}/accept`, { method: "POST" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPendingRide(null);
      loadEarnings();
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally {
      setAccepting(false);
    }
  };

  const decline = () => {
    Haptics.selectionAsync().catch(() => {});
    setPendingRide(null);
  };

  const notApproved = user?.captain_status !== "approved";

  return (
    <View style={styles.container} testID="captain-home">
      <View style={StyleSheet.absoluteFill}>
        <AlwarMap
          center={ALWAR_CENTER}
          pins={online ? [{ id: "me", lat: ALWAR_CENTER.lat, lng: ALWAR_CENTER.lng, kind: "driver", label: "You" }] : []}
          followFit={false}
          zoom={13}
        />
        {!online ? <View style={styles.offlineOverlay} pointerEvents="none" /> : null}
      </View>

      {/* Online toggle at top */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={styles.statusCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>Duty status</Text>
            <Text style={[styles.statusText, { color: online ? colors.success : colors.error }]}>
              {online ? "ONLINE" : "OFFLINE"}
            </Text>
          </View>
          <Switch
            testID="online-toggle"
            value={online}
            onValueChange={toggle}
            trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }}
            thumbColor={online ? colors.onBrandPrimary : "#FFFFFF"}
          />
        </View>
        {peak?.is_peak && !online ? (
          <Pressable
            testID="rush-banner"
            onPress={() => toggle(true)}
            style={styles.rushBanner}
          >
            <Ionicons name="flame" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.rushText}>{peak.message}</Text>
            <Text style={styles.rushCta}>Go Online →</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Bottom info sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{online ? "Awaiting rides…" : "You're offline"}</Text>
        <Text style={styles.sub}>
          {notApproved
            ? "Your captain profile is under review by admin."
            : online
              ? "Stay online to receive live requests around Alwar."
              : "Go online to start receiving ride requests."}
        </Text>
        <View style={styles.stats}>
          <StatCell label="Today" value={`₹${earnings.today_earnings}`} />
          <StatCell label="Rides" value={String(earnings.today_rides)} />
          <StatCell label="Active" value={String(earnings.active_rides)} />
        </View>

        <View style={styles.earnCard}>
          <View style={styles.earnRow}>
            <View style={styles.earnIcon}>
              <Ionicons name="wallet" size={18} color={colors.onBrandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.earnLabel}>All-time earnings</Text>
              <Text style={styles.earnValue}>₹{earnings.total_earnings?.toLocaleString?.("en-IN") || 0}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.earnLabel}>Rides</Text>
              <Text style={styles.earnRides}>{earnings.total_rides}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Ride Request Modal */}
      <Modal visible={!!pendingRide} transparent animationType="slide" onRequestClose={decline}>
        <View style={styles.modalWrap}>
          <View style={styles.modal} testID="ride-request-modal">
            <View style={styles.pulseBadge}>
              <Ionicons name="notifications" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.pulseText}>NEW RIDE REQUEST</Text>
            </View>
            <Text style={styles.earn}>₹{pendingRide?.fare}</Text>
            <Text style={styles.earnSub}>{pendingRide?.vehicle} • {pendingRide?.distance_km?.toFixed(1)} km</Text>

            <View style={styles.route}>
              <View style={styles.routeRow}>
                <View style={[styles.rDot, { backgroundColor: colors.success }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rLabel}>PICKUP</Text>
                  <Text style={styles.rText}>{pendingRide?.pickup_address}</Text>
                </View>
              </View>
              <View style={styles.rLine} />
              <View style={styles.routeRow}>
                <View style={[styles.rDot, { backgroundColor: colors.error }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rLabel}>DROP</Text>
                  <Text style={styles.rText}>{pendingRide?.drop_address}</Text>
                </View>
              </View>
            </View>

            <View style={styles.modalBtns}>
              <Pressable
                testID="decline-ride-button"
                onPress={decline}
                style={({ pressed }) => [styles.declineBtn, { opacity: pressed ? 0.9 : 1 }]}
              >
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
              <Pressable
                testID="accept-ride-button"
                onPress={accept}
                disabled={accepting}
                style={({ pressed }) => [styles.acceptBtn, { opacity: pressed ? 0.9 : 1 }]}
              >
                {accepting ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.acceptText}>Accept Ride</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  offlineOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 16 },
  statusCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surface, padding: 16, borderRadius: 20,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  statusLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  statusText: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  rushBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8,
    padding: 12, borderRadius: 14, backgroundColor: colors.brandPrimary,
    shadowColor: colors.brandPrimary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  rushText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12, flex: 1 },
  rushCta: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 12 },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 16, gap: 8,
  },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 13 },
  stats: {
    flexDirection: "row", gap: 8, marginTop: 12,
  },
  statCell: {
    flex: 1, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
  },
  statValue: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  earnCard: {
    marginTop: 4, padding: 14, borderRadius: 16,
    backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary,
  },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  earnIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  earnLabel: { color: colors.onBrandTertiary, fontSize: 11, fontWeight: "700", opacity: 0.7 },
  earnValue: { color: colors.onBrandTertiary, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 },
  earnRides: { color: colors.onBrandTertiary, fontSize: 22, fontWeight: "900", marginTop: 2 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: colors.surfaceInverse, padding: 24,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 12,
  },
  pulseBadge: {
    flexDirection: "row", alignSelf: "flex-start", gap: 6, alignItems: "center",
    backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  pulseText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  earn: { color: colors.brandPrimary, fontSize: 56, fontWeight: "900", letterSpacing: -1, marginTop: 8 },
  earnSub: { color: "#A3A3A3", fontSize: 13, fontWeight: "600" },
  route: { backgroundColor: "#0f0f0f", padding: 14, borderRadius: 16, gap: 12, marginTop: 12 },
  routeRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  rDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  rLabel: { color: "#A3A3A3", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  rText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  rLine: { width: 2, height: 12, backgroundColor: "#333", marginLeft: 5 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  declineBtn: {
    flex: 1, height: 56, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: "#333",
  },
  declineText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  acceptBtn: {
    flex: 2, height: 56, borderRadius: 20,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary,
  },
  acceptText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
});
