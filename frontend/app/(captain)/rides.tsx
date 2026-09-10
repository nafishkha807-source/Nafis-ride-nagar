import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";
import { StatusChip } from "../(rider)/rides";
import { RideChat } from "@/src/components/RideChat";

export default function CaptainRides() {
  const insets = useSafeAreaInsets();
  const [rides, setRides] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [chatRideId, setChatRideId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api<{ rides: any[] }>("/rides/mine");
      setRides(res.rides);
    } catch {}
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const completeRide = async (rideId: string) => {
    try {
      await api(`/rides/${rideId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      load();
    } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]} testID="captain-rides">
      <Text style={styles.header}>Accepted Rides</Text>
      <FlatList
        data={rides}
        keyExtractor={(r) => r.ride_id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>No rides accepted yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.vehicle}>{item.vehicle}</Text>
              <StatusChip status={item.status} />
            </View>
            <View style={styles.addr}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={styles.addrText}>{item.pickup_address}</Text>
            </View>
            <View style={styles.addr}>
              <View style={[styles.dot, { backgroundColor: colors.error }]} />
              <Text style={styles.addrText}>{item.drop_address}</Text>
            </View>
            <View style={styles.rowBottom}>
              <Text style={styles.meta}>Rider: {item.rider_name || "—"}</Text>
              <Text style={styles.fare}>₹{item.fare}</Text>
            </View>
            {item.status !== "COMPLETED" && item.status !== "CANCELLED" ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                <Pressable
                  testID={`chat-ride-${item.ride_id}`}
                  onPress={() => setChatRideId(item.ride_id)}
                  style={styles.chatBtn}
                >
                  <Ionicons name="chatbubble-ellipses" size={16} color={colors.onSurface} />
                  <Text style={styles.chatText}>Chat</Text>
                </Pressable>
                <Pressable
                  testID={`complete-ride-${item.ride_id}`}
                  onPress={() => completeRide(item.ride_id)}
                  style={[styles.completeBtn, { flex: 1 }]}
                >
                  <Text style={styles.completeText}>Complete Ride</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />
      <RideChat
        visible={!!chatRideId}
        onClose={() => setChatRideId(null)}
        rideId={chatRideId || ""}
        myRole="captain"
      />
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
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  vehicle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  addr: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  addrText: { color: colors.onSurfaceSecondary, fontSize: 13 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  meta: { color: colors.muted, fontSize: 12 },
  fare: { color: colors.onSurface, fontWeight: "800", fontSize: 16 },
  completeBtn: {
    backgroundColor: colors.brandPrimary, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center", marginTop: 6,
  },
  completeText: { color: colors.onBrandPrimary, fontWeight: "800" },
  chatBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border, height: 44,
  },
  chatText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
});
