import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#171717",
  surfaceSecondary: "#F2F2F2",
  onSurfaceSecondary: "#171717",
  surfaceTertiary: "#E5E5E5",
  onSurfaceTertiary: "#171717",
  surfaceInverse: "#222222",
  onSurfaceInverse: "#FFFFFF",
  muted: "#737373",
  brand: "#FFCC00",
  onBrand: "#222222",
  brandPrimary: "#FFCC00",
  onBrandPrimary: "#222222",
  brandSecondary: "#FFE680",
  onBrandSecondary: "#222222",
  brandTertiary: "#FFF5CC",
  onBrandTertiary: "#222222",
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#171717",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#F5F5F5",
  onInfo: "#171717",
  border: "#E5E5E5",
  borderStrong: "#D4D4D4",
  divider: "#E5E5E5",
};

const dark = {
  surface: "#121212",
  onSurface: "#F2F2F2",
  surfaceSecondary: "#1E1E1E",
  onSurfaceSecondary: "#F2F2F2",
  surfaceTertiary: "#2A2A2A",
  onSurfaceTertiary: "#F2F2F2",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#171717",
  muted: "#A3A3A3",
  brand: "#FFCC00",
  onBrand: "#222222",
  brandPrimary: "#FFCC00",
  onBrandPrimary: "#222222",
  brandSecondary: "#D4A800",
  onBrandSecondary: "#171717",
  brandTertiary: "#332900",
  onBrandTertiary: "#FFCC00",
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#171717",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#1E1E1E",
  onInfo: "#F2F2F2",
  border: "#2A2A2A",
  borderStrong: "#404040",
  divider: "#2A2A2A",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = themes.light;
