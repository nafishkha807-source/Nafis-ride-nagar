import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function CaptainProfile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [taps, setTaps] = useState(0);
  const secretTap = () => {
    const n = taps + 1;
    setTaps(n);
    if (n >= 5) { setTaps(0); router.push("/admin"); }
    setTimeout(() => setTaps(0), 2000);
  };

  const status = user?.captain_status || "pending";
  const badgeColor =
    status === "approved" ? colors.success :
    status === "blocked" ? colors.error :
    colors.warning;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]} testID="captain-profile">
      <Pressable onPress={secretTap} testID="captain-secret-logo">
        <View style={styles.avatar}>
          <Ionicons name="car-sport" size={40} color={colors.onBrandPrimary} />
        </View>
      </Pressable>
      <Text style={styles.name}>{user?.name || "Captain"}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={[styles.chip, { backgroundColor: badgeColor }]}>
        <Text style={styles.chipText}>{status.toUpperCase()}</Text>
      </View>

      <View style={styles.list}>
        <Row icon="wallet" label="Earnings today: ₹0" />
        <Row
          icon="star"
          label={`Rating: ${user?.total_ratings ? `${user.avg_rating.toFixed(1)} (${user.total_ratings})` : "New captain"}`}
        />
        {user?.vehicle_number ? <Row icon="car-sport" label={`Plate: ${user.vehicle_number}`} /> : null}
        {user?.is_admin ? (
          <Pressable onPress={() => router.push("/admin")} testID="open-admin-button">
            <Row icon="shield-checkmark" label="Admin Dashboard" chevron />
          </Pressable>
        ) : null}
      </View>

      <Pressable onPress={signOut} testID="captain-signout" style={styles.signOut}>
        <Ionicons name="log-out-outline" size={18} color={colors.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function Row({ icon, label, chevron }: any) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.brandPrimary} />
      <Text style={styles.rowText}>{label}</Text>
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, alignItems: "center", paddingHorizontal: 16, gap: 8 },
  avatar: {
    width: 88, height: 88, borderRadius: 24, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginTop: 8,
  },
  name: { color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: 8 },
  email: { color: colors.muted, fontSize: 13 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 6 },
  chipText: { color: "#FFFFFF", fontWeight: "800", fontSize: 11, letterSpacing: 0.8 },
  list: { alignSelf: "stretch", marginTop: 24, gap: 8 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 12,
  },
  rowText: { color: colors.onSurface, fontSize: 14, fontWeight: "600", flex: 1 },
  signOut: {
    marginTop: "auto", marginBottom: 24, flexDirection: "row", gap: 8,
    alignItems: "center", padding: 12,
  },
  signOutText: { color: colors.error, fontWeight: "700" },
});
