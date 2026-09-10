import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";

LogBox.ignoreAllLogs(true);

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const first = segments[0];
    if (!user) {
      if (first !== "login") router.replace("/login");
      return;
    }
    if (user.role === "unset") {
      if (first !== "role-select") router.replace("/role-select");
      return;
    }
    // if on login or role-select but authenticated with role, push to correct home
    if (first === "login" || first === "role-select" || first === undefined) {
      if (user.role === "rider") router.replace("/(rider)");
      else if (user.role === "captain") router.replace("/(captain)");
    }
  }, [user, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="role-select" />
      <Stack.Screen name="(rider)" />
      <Stack.Screen name="(captain)" />
      <Stack.Screen name="ride-status" options={{ presentation: "card" }} />
      <Stack.Screen name="admin" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <AuthGate />
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
