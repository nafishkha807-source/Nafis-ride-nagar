import { View, Text, StyleSheet, Modal, TextInput, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";
import { colors } from "@/src/theme";

type Props = {
  visible: boolean;
  onSubmit: (phone: string) => Promise<void>;
  onSkip?: () => void;
};

export function PhonePrompt({ visible, onSubmit, onSkip }: Props) {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return;
    setSaving(true);
    try {
      await onSubmit(digits);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.wrap}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="phone-prompt">
          <View style={styles.handle} />
          <View style={styles.iconWrap}>
            <Ionicons name="call" size={22} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>Add your phone number</Text>
          <Text style={styles.sub}>
            Your captain uses this to reach you at pickup. We&apos;ll ask this only once.
          </Text>

          <View style={styles.inputRow}>
            <Text style={styles.prefix}>+91</Text>
            <TextInput
              testID="phone-input"
              value={phone}
              onChangeText={setPhone}
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.input}
              autoFocus
            />
          </View>

          <Pressable
            testID="phone-save-button"
            disabled={saving || phone.replace(/\D/g, "").length < 10}
            onPress={save}
            style={({ pressed }) => [
              styles.cta,
              (saving || phone.replace(/\D/g, "").length < 10) && { opacity: 0.5 },
              pressed && { opacity: 0.9 },
            ]}
          >
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>Save & Continue</Text>}
          </Pressable>

          {onSkip ? (
            <Pressable testID="phone-skip-button" onPress={onSkip}>
              <Text style={styles.skip}>Skip for now</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, gap: 10,
  },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  inputRow: {
    flexDirection: "row", alignItems: "center", marginTop: 8,
    backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  prefix: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  input: { flex: 1, color: colors.onSurface, fontSize: 15, paddingVertical: 12, paddingLeft: 8, letterSpacing: 0.5 },
  cta: {
    height: 52, borderRadius: 16, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginTop: 8,
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
  skip: { color: colors.muted, textAlign: "center", paddingVertical: 8, fontSize: 13 },
});
