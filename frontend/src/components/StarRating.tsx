import { View, Text, Pressable, StyleSheet } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";

type Props = {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  readonly?: boolean;
};

export function StarRating({ value, onChange, size = 32, readonly }: Props) {
  return (
    <View style={styles.row} testID="star-rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        return (
          <Pressable
            key={n}
            disabled={readonly}
            testID={`star-${n}`}
            onPress={() => onChange?.(n)}
            hitSlop={6}
            style={{ paddingHorizontal: 3 }}
          >
            <Ionicons
              name={filled ? "star" : "star-outline"}
              size={size}
              color={filled ? colors.brandPrimary : colors.borderStrong}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
