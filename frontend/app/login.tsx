import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setLoading(true);
    try {
      await signIn();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} testID="login-screen">
      <LinearGradient
        colors={["#222222", "#0f0f0f"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.hero}>
        <View style={styles.logoBadge}>
          <Ionicons name="bicycle" size={40} color={colors.onBrandPrimary} />
        </View>
        <Text style={styles.brand}>Nafis Ride</Text>
        <Text style={styles.tag}>Alwar's own ride experience</Text>
      </View>

      <View style={styles.bottom}>
        <Text style={styles.h1}>Get moving in Alwar</Text>
        <Text style={styles.h2}>Book a Bike or Auto in seconds. Sign in to continue.</Text>

        <Pressable
          testID="google-signin-button"
          onPress={handle}
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.9 : 1 }]}
        >
          {loading ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.fine}>By continuing, you agree to Nafis Ride Terms & Privacy.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between", backgroundColor: "#222222" },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  logoBadge: {
    width: 80, height: 80, borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.brandPrimary, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  brand: { color: "#FFFFFF", fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  tag: { color: "#A3A3A3", fontSize: 14 },
  bottom: { gap: 16 },
  h1: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  h2: { color: "#A3A3A3", fontSize: 14, lineHeight: 20 },
  cta: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 20,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 12,
  },
  ctaText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  fine: { color: "#737373", fontSize: 11, textAlign: "center", marginTop: 8 },
});
