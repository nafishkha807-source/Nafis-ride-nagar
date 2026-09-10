import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

export default function RiderRides() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [rides, setRides] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api<{ rides: any[] }>("/rides/mine");
      setRides(res.rides);
    } catch {}
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]} testID="rider-rides-screen">
      <Text style={styles.header}>Your Rides</Text>
      <FlatList
        data={rides}
        keyExtractor={(r) => r.ride_id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bicycle-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>No rides yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`ride-row-${item.ride_id}`}
            onPress={() => router.push({ pathname: "/ride-status", params: { rideId: item.ride_id } })}
            style={styles.card}
          >
            <View style={styles.rowTop}>
              <Text style={styles.vehicle}>{item.vehicle}</Text>
              <StatusChip status={item.status} />
            </View>
            <View style={styles.addr}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={styles.addrText} numberOfLines={1}>{item.pickup_address}</Text>
            </View>
            <View style={styles.addr}>
              <View style={[styles.dot, { backgroundColor: colors.error }]} />
              <Text style={styles.addrText} numberOfLines={1}>{item.drop_address}</Text>
            </View>
            <View style={styles.rowBottom}>
              <Text style={styles.meta}>{item.distance_km?.toFixed(1)} km</Text>
              <Text style={styles.fare}>₹{item.fare}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

export function StatusChip({ status }: { status: string }) {
  const bg =
    status === "COMPLETED" ? colors.success :
    status === "CANCELLED" ? colors.error :
    status === "ACCEPTED" || status === "ARRIVING" || status === "IN_PROGRESS" ? colors.brandPrimary :
    colors.warning;
  const fg = status === "COMPLETED" || status === "CANCELLED" ? "#FFFFFF" : colors.onBrandPrimary;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: fg }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { color: colors.onSurface, fontSize: 26, fontWeight: "800", paddingHorizontal: 16 },
  empty: { alignItems: "center", padding: 40, gap: 8 },
  emptyText: { color: colors.muted, fontSize: 14 },
  card: {
    padding: 14, borderRadius: 16, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  vehicle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  addr: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  addrText: { color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  meta: { color: colors.muted, fontSize: 12 },
  fare: { color: colors.onSurface, fontWeight: "800", fontSize: 16 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
});
