import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;

const TOKEN_KEY = "nafis_session_token";
let memoryToken: string | null = null;

async function readToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") memoryToken = window.localStorage.getItem(TOKEN_KEY);
  } else {
    memoryToken = await SecureStore.getItemAsync(TOKEN_KEY);
  }
  return memoryToken;
}

export async function setToken(token: string) {
  memoryToken = token;
  if (Platform.OS === "web") {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

export async function clearToken() {
  memoryToken = null;
  if (Platform.OS === "web") {
    window.localStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await readToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as any),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    const err: any = new Error(detail);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
