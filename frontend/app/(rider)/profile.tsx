import { View, Text, StyleSheet, Pressable, TextInput, Alert, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { colors } from "@/src/theme";

export default function RiderProfile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [taps, setTaps] = useState(0);
  const [rewards, setRewards] = useState<any>(null);
  const [refCode, setRefCode] = useState("");
  const [applying, setApplying] = useState(false);

  const loadRewards = useCallback(() => {
    api<any>("/rewards/me").then(setRewards).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { loadRewards(); }, [loadRewards]));

  const applyCode = async () => {
    if (!refCode.trim()) return;
    setApplying(true);
    try {
      await api("/referral/apply", { method: "POST", body: JSON.stringify({ code: refCode.trim().toUpperCase() }) });
      Alert.alert("Applied!", "Referral applied. Complete your first ride to earn ₹50.");
      setRefCode("");
      loadRewards();
    } catch (e: any) {
      Alert.alert("Couldn't apply", e.message);
    } finally { setApplying(false); }
  };

  const shareCode = async () => {
    if (!rewards?.referral_code) return;
    try {
      await Share.share({
        message: `Try Nafis Ride in Alwar! Use my code ${rewards.referral_code} and get ₹50 off your first ride. I get ₹50 too when you book.`,
      });
    } catch {}
  };

  const secretTap = () => {
    const n = taps + 1;
    setTaps(n);
    if (n >= 5) { setTaps(0); router.push("/admin"); }
    setTimeout(() => setTaps(0), 2000);
  };

  const rewardAmt = rewards?.reward_amount || 50;
  const every = rewards?.reward_every || 5;
  const remaining = rewards?.rides_until_next_reward ?? every;
  const progress = ((every - remaining) / every) * 100;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]} testID="rider-profile">
      <Pressable onPress={secretTap} testID="rider-secret-logo">
        <View style={styles.avatar}>
          <Ionicons name="person" size={40} color={colors.onBrandPrimary} />
        </View>
      </Pressable>
      <Text style={styles.name}>{user?.name || "Rider"}</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <View style={styles.roleBadge}>
        <Text style={styles.roleText}>RIDER</Text>
      </View>

      <View style={styles.rewardsCard} testID="rewards-card">
        <View style={styles.rewardTop}>
          <View style={styles.rewardIcon}>
            <Ionicons name="gift" size={20} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rewardLabel}>Nafis Credits</Text>
            <Text style={styles.rewardValue}>₹{rewards?.credits ?? 0}</Text>
          </View>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressHint}>
          {remaining === every && (rewards?.completed_rides || 0) === 0
            ? `Complete ${every} rides to earn ₹${rewardAmt} credit`
            : `${remaining} more ride${remaining === 1 ? "" : "s"} until your next ₹${rewardAmt} credit`}
        </Text>
      </View>

      <View style={styles.referCard} testID="referral-card">
        <View style={styles.referHeader}>
          <Ionicons name="people" size={18} color={colors.brandPrimary} />
          <Text style={styles.referTitle}>Refer a friend, earn ₹{rewards?.referral_bonus ?? 50} each</Text>
        </View>
        {rewards?.referral_code ? (
          <View style={styles.codeRow}>
            <View style={styles.codeBox}>
              <Text style={styles.codeText} selectable>{rewards.referral_code}</Text>
            </View>
            <Pressable testID="share-referral-button" onPress={shareCode} style={styles.shareBtn}>
              <Ionicons name="share-social" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.shareText}>Share</Text>
            </Pressable>
          </View>
        ) : null}

        {!rewards?.referred_by && (rewards?.completed_rides || 0) === 0 ? (
          <View style={styles.applyRow}>
            <TextInput
              testID="referral-code-input"
              value={refCode}
              onChangeText={setRefCode}
              placeholder="Have a friend's code?"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              style={styles.applyInput}
              maxLength={12}
            />
            <Pressable
              testID="apply-referral-button"
              onPress={applyCode}
              disabled={applying || !refCode.trim()}
              style={[styles.applyBtn, (applying || !refCode.trim()) && { opacity: 0.4 }]}
            >
              <Text style={styles.applyBtnText}>Apply</Text>
            </Pressable>
          </View>
        ) : rewards?.referred_by ? (
          <Text style={styles.referUsed}>✓ Referral code applied</Text>
        ) : null}
      </View>

      <View style={styles.list}>
        <Row icon="location" label="Alwar, Rajasthan" />
        <Row icon="pricetag" label="Base ₹15 + ₹8/km" />
        {user?.is_admin ? (
          <Pressable onPress={() => router.push("/admin")} testID="open-admin-button">
            <Row icon="shield-checkmark" label="Admin Dashboard" chevron />
          </Pressable>
        ) : null}
      </View>

      <Pressable onPress={signOut} testID="rider-signout" style={styles.signOut}>
        <Ionicons name="log-out-outline" size={18} color={colors.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function Row({ icon, label, chevron }: { icon: any; label: string; chevron?: boolean }) {
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
  roleBadge: {
    backgroundColor: colors.brandTertiary, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, marginTop: 4,
  },
  roleText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 11, letterSpacing: 0.8 },
  rewardsCard: {
    alignSelf: "stretch", marginTop: 16, marginHorizontal: 0,
    padding: 14, borderRadius: 20, backgroundColor: colors.surfaceInverse, gap: 10,
  },
  rewardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  rewardIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  rewardLabel: { color: "#A3A3A3", fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  rewardValue: { color: colors.brandPrimary, fontSize: 24, fontWeight: "900", marginTop: 2 },
  progressBar: {
    height: 6, borderRadius: 3, backgroundColor: "#333", overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: colors.brandPrimary, borderRadius: 3 },
  progressHint: { color: "#A3A3A3", fontSize: 12 },
  referCard: {
    alignSelf: "stretch", marginTop: 12, padding: 14, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, gap: 12,
  },
  referHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  referTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 14, flex: 1 },
  codeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  codeBox: {
    flex: 1, backgroundColor: colors.brandTertiary, borderRadius: 12, borderWidth: 1,
    borderColor: colors.brandPrimary, paddingVertical: 12, alignItems: "center",
  },
  codeText: { color: colors.onBrandTertiary, fontWeight: "900", fontSize: 16, letterSpacing: 2 },
  shareBtn: {
    height: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.brandPrimary,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  shareText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
  applyRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  applyInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10,
    color: colors.onSurface, letterSpacing: 1.2, fontWeight: "700",
  },
  applyBtn: {
    height: 42, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.surfaceInverse,
    alignItems: "center", justifyContent: "center",
  },
  applyBtnText: { color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 13 },
  referUsed: { color: colors.success, fontWeight: "800", fontSize: 12 },
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
