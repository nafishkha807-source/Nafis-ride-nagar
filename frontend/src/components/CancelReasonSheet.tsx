import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { colors } from "@/src/theme";

const REASONS = [
  "Captain took too long",
  "Captain didn't move",
  "Wrong pickup location",
  "Fare too high",
  "Changed my plans",
  "Booked by mistake",
  "Other",
];

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
};

export function CancelReasonSheet({ visible, onCancel, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try { await onConfirm(selected); } finally { setSubmitting(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.wrap}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="cancel-reason-sheet">
          <View style={styles.handle} />
          <Text style={styles.title}>Cancel ride?</Text>
          <Text style={styles.sub}>Help us improve — tell us why.</Text>

          <View style={styles.list}>
            {REASONS.map((r) => (
              <Pressable
                key={r}
                testID={`cancel-reason-${r}`}
                onPress={() => setSelected(r)}
                style={[styles.row, selected === r && styles.rowSelected]}
              >
                <View style={[styles.radio, selected === r && styles.radioSelected]}>
                  {selected === r ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={styles.rowText}>{r}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable testID="cancel-keep-ride" onPress={onCancel} style={styles.keepBtn}>
              <Text style={styles.keepText}>Keep Ride</Text>
            </Pressable>
            <Pressable
              testID="cancel-confirm-button"
              disabled={!selected || submitting}
              onPress={submit}
              style={[styles.confirmBtn, (!selected || submitting) && { opacity: 0.5 }]}
            >
              {submitting ? <ActivityIndicator color={colors.onError} /> : (
                <>
                  <Ionicons name="close-circle" size={16} color={colors.onError} />
                  <Text style={styles.confirmText}>Cancel Ride</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, gap: 8,
  },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  list: { gap: 8, marginTop: 4 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  rowSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  radioSelected: { borderColor: colors.brandPrimary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  rowText: { color: colors.onSurface, fontSize: 14, fontWeight: "600", flex: 1 },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  keepBtn: {
    flex: 1, height: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  keepText: { color: colors.onSurface, fontWeight: "700" },
  confirmBtn: {
    flex: 1.4, height: 52, borderRadius: 16, backgroundColor: colors.error,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
  },
  confirmText: { color: colors.onError, fontWeight: "800", fontSize: 15 },
});
