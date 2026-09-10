import React from "react";
import { View, StyleSheet, Text, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";

type Pin = { lat: number; lng: number; kind: "pickup" | "drop" | "driver" | "me"; label?: string };

type Props = {
  center?: { lat: number; lng: number };
  pins?: Pin[];
  height?: number | string;
};

// Mock map: gridded surface with pins. Placeholder for when Google Maps key is provided.
export function MapPlaceholder({ pins = [], height = "100%" }: Props) {
  const width = Dimensions.get("window").width;

  return (
    <View style={[styles.container, { height: height as any }]} testID="map-placeholder">
      <LinearGradient
        colors={["#2A2A2A", "#171717", "#0f0f0f"]}
        style={StyleSheet.absoluteFill}
      />
      {/* grid */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: 12 }).map((_, i) => (
          <View
            key={`h${i}`}
            style={[styles.gridLine, { top: (i * 60) % 800, width }]}
          />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View
            key={`v${i}`}
            style={[styles.gridLineV, { left: (i * 60) % width }]}
          />
        ))}
      </View>

      {/* central Alwar label */}
      <View style={styles.cityChip}>
        <Ionicons name="location" size={14} color={colors.brandPrimary} />
        <Text style={styles.cityText}>Alwar, Rajasthan</Text>
      </View>

      {/* pins as absolute badges - simple scatter */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {pins.map((p, i) => {
          const top = 100 + ((i * 87) % 400);
          const left = 40 + ((i * 113) % (width - 100));
          const color =
            p.kind === "pickup" ? colors.success :
            p.kind === "drop" ? colors.error :
            p.kind === "driver" ? colors.brandPrimary :
            colors.info;
          return (
            <View key={i} style={[styles.pin, { top, left }]}>
              <View style={[styles.pinDot, { backgroundColor: color }]} />
              {p.label ? <Text style={styles.pinLabel}>{p.label}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: "#171717",
    overflow: "hidden",
  },
  gridLine: {
    position: "absolute",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  gridLineV: {
    position: "absolute",
    width: 1,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  cityChip: {
    position: "absolute",
    top: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  cityText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  pin: {
    position: "absolute",
    alignItems: "center",
    gap: 4,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  pinLabel: {
    color: "#FFFFFF",
    fontSize: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
