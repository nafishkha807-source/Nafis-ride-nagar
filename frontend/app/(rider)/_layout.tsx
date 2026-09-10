import { Tabs } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";

export default function RiderLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.onSurfaceInverse,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceInverse,
          borderTopColor: colors.surfaceInverse,
        },
        tabBarItemStyle: { alignSelf: "center" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Book",
          tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: "Rides",
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
