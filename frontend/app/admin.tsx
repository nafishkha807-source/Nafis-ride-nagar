import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";
import { WeeklyRevenueChart, WeekDay } from "@/src/components/WeeklyRevenueChart";
import { PeakHoursChart, HourRow } from "@/src/components/PeakHoursChart";

type Tab = "overview" | "drivers" | "riders" | "captains" | "rides" | "earnings";

export default function Admin() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [rides, setRides] = useState<any[]>([]);
  const [earnings, setEarnings] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<WeekDay[]>([]);
  const [peakHours, setPeakHours] = useState<HourRow[]>([]);
  const [cancelReasons, setCancelReasons] = useState<any[]>([]);
  const [fare, setFare] = useState({ base_fare: "15", per_km: "8" });
  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.is_admin) return;
    setRefreshing(true);
    try {
      const promises: Promise<any>[] = [
        api<any>("/admin/overview"),
        api<{ days: WeekDay[] }>("/admin/revenue/weekly"),
        api<{ reasons: any[] }>("/admin/cancel-reasons"),
        api<{ hours: HourRow[] }>("/admin/peak-hours"),
      ];
      if (tab === "riders" || tab === "captains") {
        promises.push(api<{ users: any[] }>(`/admin/users?role=${tab === "captains" ? "captain" : "rider"}`));
      } else if (tab === "rides") {
        promises.push(api<{ rides: any[] }>("/admin/rides"));
      } else if (tab === "earnings") {
        promises.push(api<{ earnings: any[] }>("/admin/earnings"));
      }
      const results = await Promise.all(promises);
      setOverview(results[0]);
      setWeekly(results[1].days || []);
      setCancelReasons(results[2].reasons || []);
      setPeakHours(results[3].hours || []);
      if (tab === "riders" || tab === "captains") setUsers(results[4].users);
      if (tab === "rides") setRides(results[4].rides);
      if (tab === "earnings") setEarnings(results[4].earnings);
    } catch (e: any) {
      console.warn(e.message);
    }
    setRefreshing(false);
  }, [tab, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<any>("/config/fare").then((c) => setFare({ base_fare: String(c.base_fare), per_km: String(c.per_km) })).catch(() => {});
  }, []);

  // auto-refresh overview every 5s when on overview tab
  useEffect(() => {
    if (tab !== "overview" && tab !== "drivers") return;
    const id = setInterval(() => {
      api<any>("/admin/overview").then(setOverview).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [tab]);

  const claimAdmin = async () => {
    setClaiming(true);
    try {
      await api<{ user: any }>("/admin/claim", { method: "POST", body: JSON.stringify({ code }) });
      await refresh();
      setCode("");
    } catch (e: any) {
      Alert.alert("Invalid code", e.message);
    } finally { setClaiming(false); }
  };

  // ---- Digest emails ----
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestSummary, setDigestSummary] = useState<any>(null);
  const [digestRuns, setDigestRuns] = useState<any[]>([]);
  const [digestTestTo, setDigestTestTo] = useState("delivered@resend.dev");

  const loadDigestRuns = useCallback(async () => {
    try {
      const res = await api<{ runs: any[] }>("/admin/digest/runs");
      setDigestRuns(res.runs || []);
    } catch {}
  }, []);
  useEffect(() => { if (tab === "overview") loadDigestRuns(); }, [tab, loadDigestRuns]);

  const sendDigest = async () => {
    setDigestBusy(true);
    try {
      const res = await api<{ ok: boolean; summary: any }>("/admin/digest/send", { method: "POST" });
      setDigestSummary(res.summary);
      await loadDigestRuns();
      const s = res.summary || {};
      Alert.alert("Weekly digest sent", `Riders: ${s.riders || 0}\nCaptains: ${s.captains || 0}\nAdmins: ${s.admins || 0}\nFailed: ${s.failed || 0}`);
    } catch (e: any) {
      Alert.alert("Digest failed", e.message);
    } finally { setDigestBusy(false); }
  };

  const testDigestSend = async () => {
    if (!digestTestTo.trim() || !digestTestTo.includes("@")) {
      Alert.alert("Bad email", "Enter a valid email to receive the test send.");
      return;
    }
    setDigestBusy(true);
    try {
      const res = await api<{ ok: boolean; email_id: string | null }>("/admin/digest/test-send", {
        method: "POST",
        body: JSON.stringify({ to: digestTestTo.trim() }),
      });
      Alert.alert(res.ok ? "Test sent" : "Test failed",
        res.ok ? `Email queued (${res.email_id}).` : "Provider rejected the address.");
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally { setDigestBusy(false); }
  };

  const saveFare = async () => {
    try {
      await api("/admin/fare", {
        method: "PUT",
        body: JSON.stringify({ base_fare: parseFloat(fare.base_fare), per_km: parseFloat(fare.per_km) }),
      });
      Alert.alert("Saved", "Fare updated across the system.");
    } catch (e: any) { Alert.alert("Failed", e.message); }
  };

  const setCaptainStatus = async (id: string, status: string) => {
    try {
      await api(`/admin/captains/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      load();
    } catch (e: any) { Alert.alert("Failed", e.message); }
  };

  const forceComplete = async (rideId: string) => {
    try {
      await api(`/admin/rides/${rideId}/force-complete`, { method: "POST" });
      load();
    } catch (e: any) { Alert.alert("Failed", e.message); }
  };

  if (!user?.is_admin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="admin-back">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerText}>Admin Access</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.claimBox}>
          <Ionicons name="shield-checkmark" size={36} color={colors.brandPrimary} />
          <Text style={styles.claimTitle}>Enter Admin Code</Text>
          <Text style={styles.claimSub}>Nafis Ride admins only. Default code: NAFIS-ADMIN</Text>
          <TextInput
            testID="admin-code-input"
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Admin code"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
          />
          <Pressable testID="admin-claim-button" onPress={claimAdmin} style={styles.claimBtn} disabled={claiming}>
            {claiming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.claimBtnText}>Unlock</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "overview", label: "Overview", icon: "grid" },
    { key: "drivers", label: "Live Drivers", icon: "flash" },
    { key: "riders", label: "Riders", icon: "people" },
    { key: "captains", label: "Captains", icon: "car-sport" },
    { key: "rides", label: "Rides", icon: "list" },
    { key: "earnings", label: "Earnings", icon: "cash" },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="admin-dashboard">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="admin-back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.headerText}>Admin Console</Text>
          <Text style={styles.headerSub}>Nafis Ride • Alwar</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        style={styles.chipsRow}
      >
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            testID={`admin-tab-${t.key}`}
            onPress={() => setTab(t.key)}
            style={[styles.tabChip, tab === t.key && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
          >
            <Ionicons name={t.icon} size={13} color={tab === t.key ? colors.onBrandPrimary : colors.onSurface} />
            <Text style={[styles.tabChipText, tab === t.key && { color: colors.onBrandPrimary }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.brandPrimary} />}
      >
        {tab === "overview" && overview ? (
          <>
            {/* Hero revenue card */}
            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <Text style={styles.heroLabel}>TOTAL REVENUE</Text>
                <View style={styles.livePulse}>
                  <View style={styles.livePulseDot} />
                  <Text style={styles.livePulseText}>LIVE</Text>
                </View>
              </View>
              <Text style={styles.heroValue}>₹{overview.total_revenue?.toLocaleString?.("en-IN") || 0}</Text>
              <View style={styles.heroRow}>
                <View style={styles.heroCell}>
                  <Text style={styles.heroCellLabel}>Today</Text>
                  <Text style={styles.heroCellValue}>₹{overview.today_revenue || 0}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroCell}>
                  <Text style={styles.heroCellLabel}>Today&apos;s Rides</Text>
                  <Text style={styles.heroCellValue}>{overview.today_rides || 0}</Text>
                </View>
              </View>
            </View>

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <StatCard label="Riders" value={overview.riders} icon="people" />
              <StatCard label="Captains" value={overview.captains} icon="car-sport" />
              <StatCard label="Online Now" value={overview.active_captains} icon="flash" tint={colors.success} />
              <StatCard label="Live Rides" value={overview.live_rides} icon="location" tint={colors.brandPrimary} />
              <StatCard label="Completed" value={overview.completed_rides} icon="checkmark-circle" tint={colors.success} />
              <StatCard label="Cancelled" value={overview.cancelled_rides} icon="close-circle" tint={colors.error} />
            </View>

            <WeeklyRevenueChart days={weekly} />
            <PeakHoursChart hours={peakHours} />

            {cancelReasons.length > 0 ? (
              <>
                <Text style={styles.section}>Recent Cancellation Reasons (last 30 days)</Text>
                <View style={{ gap: 6 }}>
                  {cancelReasons.slice(0, 8).map((r, i) => (
                    <View key={`${r.reason}-${r.by}-${i}`} style={styles.reasonRow} testID={`cancel-reason-${i}`}>
                      <View style={styles.reasonBadge}>
                        <Text style={styles.reasonCount}>{r.count}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reasonText}>{r.reason}</Text>
                        <Text style={styles.reasonBy}>by {r.by}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.section}>Fare Configuration</Text>
            <View style={styles.card}>
              <Text style={styles.label}>Base fare (₹)</Text>
              <TextInput
                testID="fare-base-input"
                style={styles.input}
                keyboardType="numeric"
                value={fare.base_fare}
                onChangeText={(v) => setFare((s) => ({ ...s, base_fare: v }))}
              />
              <Text style={styles.label}>Per km (₹)</Text>
              <TextInput
                testID="fare-perkm-input"
                style={styles.input}
                keyboardType="numeric"
                value={fare.per_km}
                onChangeText={(v) => setFare((s) => ({ ...s, per_km: v }))}
              />
              <Pressable testID="save-fare-button" onPress={saveFare} style={styles.cta}>
                <Text style={styles.ctaText}>Save Fare</Text>
              </Pressable>
            </View>

            <Text style={styles.section}>Weekly Digest Emails</Text>
            <View style={styles.card} testID="digest-card">
              <Text style={styles.digestBlurb}>
                Sends weekly summary to riders, captains and admins.
                Scheduled every Monday 8:00 AM IST via Resend.
              </Text>
              <Pressable
                testID="send-digest-now-button"
                onPress={sendDigest}
                disabled={digestBusy}
                style={[styles.cta, digestBusy && { opacity: 0.6 }]}
              >
                {digestBusy ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.ctaText}>Send weekly digest now</Text>
                )}
              </Pressable>
              {digestSummary ? (
                <View style={styles.digestSummary} testID="digest-last-summary">
                  <Text style={styles.digestSumText}>
                    Last run — Riders: {digestSummary.riders || 0} · Captains: {digestSummary.captains || 0} · Admins: {digestSummary.admins || 0} · Failed: {digestSummary.failed || 0}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.label, { marginTop: 14 }]}>Send a test email</Text>
              <TextInput
                testID="digest-test-email-input"
                style={styles.input}
                value={digestTestTo}
                onChangeText={setDigestTestTo}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
              />
              <Pressable
                testID="send-digest-test-button"
                onPress={testDigestSend}
                disabled={digestBusy}
                style={[styles.ctaSecondary, digestBusy && { opacity: 0.6 }]}
              >
                <Text style={styles.ctaSecondaryText}>Send test email</Text>
              </Pressable>
              {digestRuns.length > 0 ? (
                <View style={{ marginTop: 14 }} testID="digest-runs-list">
                  <Text style={styles.label}>Recent runs</Text>
                  {digestRuns.slice(0, 5).map((r, i) => (
                    <View key={String(r.run_at) + i} style={styles.digestRunRow} testID={`digest-run-${i}`}>
                      <Text style={styles.digestRunDate}>
                        {new Date(r.run_at).toLocaleString("en-IN", { hour12: false })}
                      </Text>
                      <Text style={styles.digestRunStats}>
                        R:{r.riders || 0} · C:{r.captains || 0} · A:{r.admins || 0}
                        {r.failed ? ` · ✕${r.failed}` : ""}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {tab === "drivers" && overview ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>ACTIVE DRIVERS</Text>
              <Text style={styles.heroValue}>{overview.active_captains || 0}</Text>
              <Text style={styles.heroSub}>Live positions refresh every 5 seconds</Text>
            </View>
            {(overview.active_drivers || []).length === 0 ? (
              <View style={styles.emptyBox} testID="no-active-drivers">
                <Ionicons name="moon-outline" size={32} color={colors.muted} />
                <Text style={styles.emptyText}>No drivers online right now.</Text>
              </View>
            ) : null}
            {(overview.active_drivers || []).map((d: any) => (
              <View key={d.user_id} style={styles.driverRow} testID={`active-driver-${d.user_id}`}>
                <View style={styles.driverAvatar}>
                  <Ionicons name="car-sport" size={18} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{d.name || "Captain"}</Text>
                  <Text style={styles.driverLoc}>
                    {d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}
                  </Text>
                </View>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>ONLINE</Text>
              </View>
            ))}
          </>
        ) : null}

        {(tab === "riders" || tab === "captains") ? (
          <View style={{ gap: 8 }}>
            {users.length === 0 ? (
              <Text style={styles.empty}>No {tab} yet.</Text>
            ) : users.map((u) => (
              <View key={u.user_id} style={styles.userRow} testID={`user-row-${u.user_id}`}>
                <View style={styles.userAvatar}>
                  <Ionicons name={tab === "captains" ? "car-sport" : "person"} size={18} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{u.name || u.email}</Text>
                  <Text style={styles.userEmail} numberOfLines={1}>
                    {u.email}{u.phone ? ` • ${u.phone}` : ""}{u.vehicle_number ? ` • ${u.vehicle_number}` : ""}
                    {tab === "captains" && u.total_ratings > 0 ? ` • ★ ${u.avg_rating?.toFixed?.(1)}` : ""}
                  </Text>
                </View>
                {tab === "captains" ? (
                  <View style={{ gap: 4, alignItems: "flex-end" }}>
                    <View style={[styles.smChip, {
                      backgroundColor:
                        u.captain_status === "approved" ? colors.success :
                        u.captain_status === "blocked" ? colors.error : colors.warning,
                    }]}>
                      <Text style={styles.smChipText}>{(u.captain_status || "pending").toUpperCase()}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Pressable testID={`approve-${u.user_id}`} onPress={() => setCaptainStatus(u.user_id, "approved")} style={styles.miniBtn}>
                        <Text style={styles.miniBtnText}>Approve</Text>
                      </Pressable>
                      <Pressable testID={`block-${u.user_id}`} onPress={() => setCaptainStatus(u.user_id, "blocked")} style={[styles.miniBtn, { backgroundColor: colors.error }]}>
                        <Text style={styles.miniBtnText}>Block</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.smChip}>
                    <Text style={styles.smChipText}>RIDER</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {tab === "rides" ? (
          <View style={{ gap: 8 }}>
            {rides.length === 0 ? (
              <Text style={styles.empty}>No rides yet.</Text>
            ) : rides.map((r) => (
              <View key={r.ride_id} style={styles.card} testID={`ride-row-${r.ride_id}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Text style={styles.rideVehicle}>{r.vehicle}</Text>
                  <View style={[styles.smChip, { backgroundColor: r.status === "COMPLETED" ? colors.success : r.status === "CANCELLED" ? colors.error : colors.brandPrimary }]}>
                    <Text style={[styles.smChipText, { color: r.status === "COMPLETED" || r.status === "CANCELLED" ? "#FFF" : colors.onBrandPrimary }]}>
                      {r.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.rideRow}>🟢 {r.pickup_address}</Text>
                <Text style={styles.rideRow}>🔴 {r.drop_address}</Text>
                <Text style={styles.rideMeta}>{r.distance_km?.toFixed(1)} km • ₹{r.fare} • {r.rider_name || "—"}{r.captain_name ? ` → ${r.captain_name}` : ""}</Text>
                {r.status !== "COMPLETED" && r.status !== "CANCELLED" ? (
                  <Pressable
                    testID={`force-complete-${r.ride_id}`}
                    onPress={() => forceComplete(r.ride_id)}
                    style={styles.forceBtn}
                  >
                    <Ionicons name="checkmark-done" size={16} color={colors.onBrandPrimary} />
                    <Text style={styles.forceText}>Force Complete</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {tab === "earnings" ? (
          <View style={{ gap: 8 }}>
            {earnings.length === 0 ? (
              <Text style={styles.empty}>No completed rides yet — earnings will appear here.</Text>
            ) : earnings.map((e, i) => (
              <View key={e.captain_id} style={styles.earnRow} testID={`earning-row-${e.captain_id}`}>
                <View style={styles.rankBadge}>
                  <Text style={styles.rankText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.earnName}>{e.captain_name || "Captain"}</Text>
                  <Text style={styles.earnMeta}>
                    {e.captain_vehicle_number || "RJ 02 —"} • {e.rides} ride{e.rides === 1 ? "" : "s"}
                  </Text>
                </View>
                <Text style={styles.earnValue}>₹{e.earnings}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, icon, tint }: { label: string; value: number; icon: any; tint?: string }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: tint || colors.brandPrimary }]}>
        <Ionicons name={icon} size={16} color={colors.onBrandPrimary} />
      </View>
      <Text style={styles.statValue}>{value ?? 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  headerText: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  headerSub: { color: colors.muted, fontSize: 11, marginTop: 1 },
  chipsRow: { flexGrow: 0, marginBottom: 8, maxHeight: 56 },
  tabChip: {
    height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: colors.surfaceSecondary,
    flexDirection: "row", gap: 6,
  },
  tabChipText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },

  heroCard: {
    backgroundColor: colors.surfaceInverse, padding: 20, borderRadius: 24, gap: 8,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { color: "#A3A3A3", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  heroValue: { color: colors.brandPrimary, fontSize: 40, fontWeight: "900", letterSpacing: -1 },
  heroSub: { color: "#A3A3A3", fontSize: 12 },
  heroRow: { flexDirection: "row", marginTop: 4, gap: 12 },
  heroCell: { flex: 1 },
  heroDivider: { width: 1, backgroundColor: "#333" },
  heroCellLabel: { color: "#A3A3A3", fontSize: 11, fontWeight: "600" },
  heroCellValue: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", marginTop: 2 },
  livePulse: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,204,0,0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  livePulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  livePulseText: { color: colors.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: {
    width: "48%", padding: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  statIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  statValue: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 4 },
  statLabel: { color: colors.muted, fontSize: 12 },

  section: { color: colors.muted, fontWeight: "700", fontSize: 12, letterSpacing: 0.8, marginTop: 8 },
  card: {
    backgroundColor: colors.surfaceSecondary, padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, gap: 8,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12,
    color: colors.onSurface, borderWidth: 1, borderColor: colors.border,
  },
  cta: {
    backgroundColor: colors.brandPrimary, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800" },
  ctaSecondary: {
    height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 6,
  },
  ctaSecondaryText: { color: colors.onSurface, fontWeight: "700" },
  digestBlurb: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  digestSummary: {
    marginTop: 4, padding: 10, borderRadius: 10,
    backgroundColor: colors.surfaceTertiary,
  },
  digestSumText: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  digestRunRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border,
  },
  digestRunDate: { color: colors.onSurfaceSecondary, fontSize: 12 },
  digestRunStats: { color: colors.muted, fontSize: 12, fontWeight: "700" },

  driverRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  driverAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  driverName: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  driverLoc: { color: colors.muted, fontSize: 12 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  onlineText: { color: colors.success, fontSize: 10, fontWeight: "800", letterSpacing: 0.6, marginLeft: 4 },
  emptyBox: {
    padding: 32, alignItems: "center", gap: 8,
    backgroundColor: colors.surfaceSecondary, borderRadius: 16,
  },
  emptyText: { color: colors.muted, fontSize: 13 },

  userRow: {
    flexDirection: "row", gap: 12, alignItems: "center",
    padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  userAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  userName: { color: colors.onSurface, fontWeight: "700" },
  userEmail: { color: colors.muted, fontSize: 12 },
  smChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.surfaceTertiary },
  smChipText: { fontWeight: "800", fontSize: 10, letterSpacing: 0.6, color: colors.onSurface },
  miniBtn: { backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  miniBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 11 },
  empty: { color: colors.muted, textAlign: "center", padding: 24 },
  rideVehicle: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  rideRow: { color: colors.onSurfaceSecondary, fontSize: 13 },
  rideMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  forceBtn: {
    marginTop: 8, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
  },
  forceText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },

  earnRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  rankBadge: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  rankText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14 },
  earnName: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  earnMeta: { color: colors.muted, fontSize: 12 },
  earnValue: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },

  reasonRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  reasonBadge: {
    minWidth: 32, height: 32, borderRadius: 10, paddingHorizontal: 8,
    backgroundColor: colors.error, alignItems: "center", justifyContent: "center",
  },
  reasonCount: { color: colors.onError, fontWeight: "900", fontSize: 14 },
  reasonText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  reasonBy: { color: colors.muted, fontSize: 11 },

  claimBox: {
    margin: 24, padding: 24, backgroundColor: colors.surfaceSecondary, borderRadius: 20,
    alignItems: "center", gap: 10,
  },
  claimTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", marginTop: 4 },
  claimSub: { color: colors.muted, fontSize: 12, textAlign: "center", marginBottom: 12 },
  claimBtn: {
    height: 48, alignSelf: "stretch", borderRadius: 14, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  claimBtnText: { color: colors.onBrandPrimary, fontWeight: "800" },
});
