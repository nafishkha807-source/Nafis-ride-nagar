import { View, Text, StyleSheet, Pressable, Modal, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { colors } from "@/src/theme";
import { StarRating } from "./StarRating";
import { api } from "@/src/api/client";

type Props = {
  visible: boolean;
  ride: any | null;
  onClose: () => void;
};

export function RideReceipt({ visible, ride, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [rated, setRated] = useState<boolean>(!!ride?.rating);

  if (!ride) return null;

  const total = ride.fare;
  const distance = Number(ride.distance_km || 0).toFixed(1);
  const method = (ride.payment_method || "cash").toUpperCase();
  const reward = Number(ride.reward_granted || 0);

  const submitRating = async (n: number) => {
    if (submitting || rated) return;
    setSubmitting(true);
    try {
      await api(`/rides/${ride.ride_id}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating: n }),
      });
      setRating(n);
      setRated(true);
    } catch (e: any) {
      Alert.alert("Rating failed", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="ride-receipt">
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={26} color={colors.onSuccess} />
            </View>
            <Text style={styles.title}>Ride Completed</Text>
            <Text style={styles.sub}>Thanks for choosing Nafis Ride</Text>
          </View>

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 10 }}>
            <View style={styles.route}>
              <View style={styles.rrow}>
                <View style={[styles.rdot, { backgroundColor: colors.success }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rLabel}>PICKUP</Text>
                  <Text style={styles.rText}>{ride.pickup_address}</Text>
                </View>
              </View>
              <View style={styles.rline} />
              <View style={styles.rrow}>
                <View style={[styles.rdot, { backgroundColor: colors.error }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rLabel}>DROP</Text>
                  <Text style={styles.rText}>{ride.drop_address}</Text>
                </View>
              </View>
            </View>

            <View style={styles.driver}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={20} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.captain_name || "Captain"}</Text>
                <Text style={styles.driverMeta}>{ride.vehicle} • {ride.captain_vehicle_number || "RJ 02 —"}</Text>
              </View>
            </View>

            <View style={styles.fareBox}>
              <Row label="Distance" value={`${distance} km`} />
              <Row label={`Base + ${distance} × per km`} value={`₹${total + (ride.credits_applied || 0)}`} />
              {ride.credits_applied > 0 ? (
                <Row label="Credits applied" value={`- ₹${ride.credits_applied}`} />
              ) : null}
              <View style={styles.hr} />
              <View style={styles.rowBig}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₹{total}</Text>
              </View>
              <View style={styles.methodChip}>
                <Ionicons name="cash" size={14} color={colors.onBrandTertiary} />
                <Text style={styles.methodText}>Paid via {method}</Text>
              </View>
            </View>

            {reward > 0 ? (
              <View style={styles.rewardBox} testID="reward-banner">
                <Ionicons name="gift" size={22} color={colors.onBrandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rewardTitle}>You earned ₹{reward} credit!</Text>
                  <Text style={styles.rewardSub}>Applied automatically on your next ride</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.rateBox}>
              <Text style={styles.rateLabel}>
                {rated ? "Thanks for rating!" : `Rate ${ride.captain_name || "your captain"}`}
              </Text>
              <StarRating
                value={rated ? (ride.rating || rating) : rating}
                onChange={submitRating}
                readonly={rated || submitting}
              />
              {rated ? (
                <Text style={styles.rateSub}>Your feedback helps us keep captains great.</Text>
              ) : (
                <Text style={styles.rateSub}>Tap a star to submit</Text>
              )}
            </View>
          </ScrollView>

          <Pressable testID="receipt-done-button" onPress={onClose} style={styles.cta}>
            <Text style={styles.ctaText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10 },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  header: { alignItems: "center", gap: 6, marginBottom: 8 },
  successIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 13 },
  route: { backgroundColor: colors.surfaceSecondary, padding: 14, borderRadius: 16, gap: 10 },
  rrow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  rdot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  rline: { width: 2, height: 10, backgroundColor: colors.border, marginLeft: 4 },
  rLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  rText: { color: colors.onSurface, fontSize: 14, fontWeight: "700", marginTop: 2 },
  driver: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surfaceSecondary, padding: 12, borderRadius: 16,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  driverName: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  driverMeta: { color: colors.muted, fontSize: 12 },
  fareBox: { backgroundColor: colors.surfaceSecondary, padding: 14, borderRadius: 16, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: colors.muted, fontSize: 13, flex: 1, marginRight: 8 },
  rowValue: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  hr: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  rowBig: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  totalValue: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  methodChip: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 4,
  },
  methodText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 11, letterSpacing: 0.4 },
  rewardBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.brandPrimary, padding: 14, borderRadius: 16,
  },
  rewardTitle: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
  rewardSub: { color: colors.onBrandPrimary, opacity: 0.75, fontSize: 12 },
  rateBox: {
    backgroundColor: colors.surfaceSecondary, padding: 14, borderRadius: 16,
    alignItems: "center", gap: 6,
  },
  rateLabel: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  rateSub: { color: colors.muted, fontSize: 12 },
  cta: {
    height: 52, borderRadius: 16, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginTop: 6,
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
});
