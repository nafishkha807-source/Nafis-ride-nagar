import { View, Text, StyleSheet } from "react-native";
import { colors } from "@/src/theme";

export type HourRow = { hour: number; rides: number; cancellations: number };

type Props = { hours: HourRow[] };

export function PeakHoursChart({ hours }: Props) {
  const max = Math.max(1, ...hours.map((h) => h.rides));
  const totalRides = hours.reduce((s, h) => s + h.rides, 0);
  const totalCanc = hours.reduce((s, h) => s + h.cancellations, 0);
  const peak = hours.reduce((best, h) => (h.rides > best.rides ? h : best), hours[0] || { hour: 0, rides: 0, cancellations: 0 });

  const fmt = (h: number) => {
    const hh = ((h + 11) % 12) + 1;
    const ap = h < 12 ? "AM" : "PM";
    return `${hh}${ap}`;
  };

  return (
    <View style={styles.card} testID="peak-hours-chart">
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>PEAK HOURS (30d, IST)</Text>
          <Text style={styles.title}>
            {totalRides > 0 ? fmt(peak.hour) : "—"}
          </Text>
          <Text style={styles.meta}>
            {totalRides} rides • {totalCanc} cancels
          </Text>
        </View>
        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
            <Text style={styles.legendText}>Rides</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: colors.error }]} />
            <Text style={styles.legendText}>Cancels</Text>
          </View>
        </View>
      </View>
      <View style={styles.chart}>
        {hours.map((h) => {
          const rideH = h.rides > 0 ? Math.max(4, (h.rides / max) * 100) : 2;
          const cancH = h.cancellations > 0 ? Math.max(4, (h.cancellations / max) * 100) : 0;
          const isPeak = h.rides === max && max > 0;
          return (
            <View key={h.hour} style={styles.col}>
              <View style={styles.barSlot}>
                {cancH > 0 ? (
                  <View style={[styles.cancBar, { height: `${cancH}%` }]} />
                ) : null}
                <View style={[styles.rideBar, { height: `${rideH}%`, backgroundColor: isPeak ? colors.brandPrimary : colors.brandSecondary }]} />
              </View>
              {h.hour % 3 === 0 ? <Text style={styles.hourLabel}>{fmt(h.hour)}</Text> : <Text style={styles.hourLabel} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 20, backgroundColor: colors.surfaceInverse, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  label: { color: "#A3A3A3", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  title: { color: colors.brandPrimary, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  meta: { color: "#A3A3A3", fontSize: 11, marginTop: 2 },
  legend: { gap: 6, marginTop: 4 },
  legendRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: "#A3A3A3", fontSize: 11 },
  chart: { height: 130, flexDirection: "row", alignItems: "flex-end", gap: 2, paddingTop: 8 },
  col: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barSlot: { width: "100%", height: 100, alignItems: "center", justifyContent: "flex-end", flexDirection: "row", gap: 1 },
  rideBar: { width: "60%", borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 2 },
  cancBar: { position: "absolute", right: 0, top: 0, bottom: 0, width: "30%", backgroundColor: colors.error, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  hourLabel: { color: "#A3A3A3", fontSize: 9, marginTop: 4, minHeight: 12 },
});
