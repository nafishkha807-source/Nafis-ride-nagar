import { View, Text, StyleSheet } from "react-native";
import { colors } from "@/src/theme";

export type WeekDay = { date: string; weekday: string; revenue: number; rides: number };

type Props = { days: WeekDay[] };

export function WeeklyRevenueChart({ days }: Props) {
  const max = Math.max(1, ...days.map((d) => d.revenue));
  const total = days.reduce((s, d) => s + d.revenue, 0);
  const rides = days.reduce((s, d) => s + d.rides, 0);

  return (
    <View style={styles.card} testID="weekly-revenue-chart">
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>7-DAY REVENUE</Text>
          <Text style={styles.title}>₹{total.toLocaleString("en-IN")}</Text>
          <Text style={styles.meta}>{rides} rides completed</Text>
        </View>
      </View>
      <View style={styles.chart}>
        {days.map((d) => {
          const heightPct = d.revenue > 0 ? Math.max(6, (d.revenue / max) * 100) : 3;
          const isMax = d.revenue === max && max > 0;
          return (
            <View key={d.date} style={styles.col} testID={`bar-${d.date}`}>
              <View style={styles.barSlot}>
                <Text style={styles.barLabel} numberOfLines={1}>
                  {d.revenue > 0 ? `₹${Math.round(d.revenue)}` : ""}
                </Text>
                <View
                  style={[
                    styles.bar,
                    { height: `${heightPct}%`, backgroundColor: isMax ? colors.brandPrimary : colors.brandSecondary },
                  ]}
                />
              </View>
              <Text style={styles.day}>{d.weekday}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16, borderRadius: 20, backgroundColor: colors.surfaceInverse, gap: 12,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: "#A3A3A3", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  title: { color: colors.brandPrimary, fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  meta: { color: "#A3A3A3", fontSize: 11, marginTop: 2 },
  chart: {
    height: 160, flexDirection: "row", alignItems: "flex-end",
    gap: 6, paddingTop: 24,
  },
  col: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  barSlot: { width: "100%", flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "70%", borderTopLeftRadius: 6, borderTopRightRadius: 6, minHeight: 3 },
  barLabel: { color: "#FFCC00", fontSize: 9, fontWeight: "800", marginBottom: 4 },
  day: { color: "#A3A3A3", fontSize: 11, fontWeight: "700", marginTop: 8 },
});
