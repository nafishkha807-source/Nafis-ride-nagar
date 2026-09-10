import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

export default function RoleSelect() {
  const insets = useSafeAreaInsets();
  const { user, setUser, signOut } = useAuth();
  const router = useRouter();
  const [logoTaps, setLogoTaps] = useState(0);
  const [saving, setSaving] = useState(false);

  const choose = async (role: "rider" | "captain") => {
    if (saving) return;
    setSaving(true);
    try {
      Haptics.selectionAsync().catch(() => {});
      const res = await api<{ user: any }>("/users/role", {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      setUser(res.user);
      router.replace(role === "rider" ? "/(rider)" : "/(captain)");
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally {
      setSaving(false);
    }
  };

  const onLogoTap = () => {
    const next = logoTaps + 1;
    setLogoTaps(next);
    if (next >= 5) {
      setLogoTaps(0);
      router.push("/admin");
    }
    setTimeout(() => setLogoTaps(0), 2000);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} testID="role-select-screen">
      <View style={styles.header}>
        <Pressable onPress={onLogoTap} testID="admin-secret-logo">
          <View style={styles.logoBadge}>
            <Ionicons name="bicycle" size={22} color={colors.onBrandPrimary} />
          </View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Hey {user?.name?.split(" ")[0] || "there"} 👋</Text>
          <Text style={styles.sub}>{user?.email}</Text>
        </View>
        <Pressable onPress={signOut} testID="signout-button" hitSlop={12}>
          <Ionicons name="log-out-outline" size={22} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>How will you use Nafis Ride?</Text>
        <Text style={styles.subtitle}>You can switch anytime from settings.</Text>

        <Pressable
          testID="choose-rider-button"
          disabled={saving}
          onPress={() => choose("rider")}
          style={({ pressed }) => [styles.card, styles.cardRider, { opacity: pressed ? 0.9 : 1 }]}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="person" size={28} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Rider</Text>
            <Text style={styles.cardText}>Book a Nafis Bike or Auto around Alwar.</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.onSurfaceSecondary} />
        </Pressable>

        <Pressable
          testID="choose-captain-button"
          disabled={saving}
          onPress={() => choose("captain")}
          style={({ pressed }) => [styles.card, styles.cardCaptain, { opacity: pressed ? 0.9 : 1 }]}
        >
          <View style={[styles.cardIcon, { backgroundColor: colors.surfaceInverse }]}>
            <Ionicons name="car-sport" size={28} color={colors.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Captain</Text>
            <Text style={styles.cardText}>Earn by accepting rides in your area.</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      <Text style={styles.fine}>Tip: tap the logo 5 times for admin access.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 24, gap: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoBadge: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  hello: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 12 },
  body: { flex: 1, gap: 12, marginTop: 12 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, marginBottom: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardRider: { backgroundColor: colors.surfaceSecondary },
  cardCaptain: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  cardIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  cardText: { color: colors.muted, fontSize: 13, marginTop: 2 },
  fine: { color: colors.muted, fontSize: 11, textAlign: "center" },
});
