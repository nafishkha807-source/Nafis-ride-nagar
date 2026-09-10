import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";
import { api } from "@/src/api/client";

type Msg = { id: string; from: "rider" | "captain"; from_name?: string; text: string; at: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  myRole: "rider" | "captain";
};

export function RideChat({ visible, onClose, rideId, myRole }: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [canned, setCanned] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ messages: Msg[] }>(`/rides/${rideId}/messages`);
      setMessages(res.messages || []);
    } catch {}
  }, [rideId]);

  useEffect(() => {
    if (!visible) return;
    api<{ canned: string[] }>(`/rides/${rideId}/messages/canned`).then((r) => setCanned(r.canned)).catch(() => {});
    load();
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [visible, load, rideId]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const send = async (t: string) => {
    if (!t.trim() || sending) return;
    setSending(true);
    try {
      const res = await api<{ message: Msg }>(`/rides/${rideId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: t }),
      });
      setMessages((m) => [...m, res.message]);
      setText("");
    } catch {} finally { setSending(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.wrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]} testID="ride-chat">
            <View style={styles.header}>
              <Text style={styles.title}>Ride Chat</Text>
              <Pressable onPress={onClose} testID="chat-close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12, gap: 8 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.length === 0 ? (
                <Text style={styles.empty}>Tap a quick message below to start.</Text>
              ) : messages.map((m) => {
                const mine = m.from === myRole;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.bubble,
                      mine ? styles.bubbleMine : styles.bubbleTheirs,
                    ]}
                  >
                    <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                      {m.text}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
              style={styles.cannedRow}
            >
              {canned.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => send(c)}
                  testID={`canned-${c}`}
                  style={styles.cannedChip}
                >
                  <Text style={styles.cannedText}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.inputRow}>
              <TextInput
                testID="chat-input"
                value={text}
                onChangeText={setText}
                placeholder="Type a message"
                placeholderTextColor={colors.muted}
                style={styles.input}
                onSubmitEditing={() => send(text)}
                returnKeyType="send"
              />
              <Pressable
                testID="chat-send-button"
                onPress={() => send(text)}
                disabled={!text.trim() || sending}
                style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
              >
                {sending ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : (
                  <Ionicons name="arrow-up" size={18} color={colors.onBrandPrimary} />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, height: "70%",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  empty: { color: colors.muted, textAlign: "center", padding: 32 },
  bubble: {
    maxWidth: "78%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
  },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleTheirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, fontWeight: "600" },
  bubbleTextMine: { color: colors.onBrandPrimary },
  bubbleTextTheirs: { color: colors.onSurface },
  cannedRow: { maxHeight: 48, paddingVertical: 8, backgroundColor: colors.surfaceSecondary },
  cannedChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    height: 32, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  cannedText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  input: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 10, color: colors.onSurface, fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
});
