import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, clearToken, setToken } from "@/src/api/client";

WebBrowser.maybeCompleteAuthSession();

export type Role = "rider" | "captain" | "unset";
export type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
  role: Role;
  is_admin: boolean;
  captain_status: "pending" | "approved" | "blocked";
  online?: boolean;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
};

const AuthCtx = createContext<AuthState | null>(null);
const processedSessionIds = new Set<string>();

function extractSessionId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const linkListenerCapturedUrl = useRef<string | null>(null);

  const exchange = useCallback(async (sessionId: string) => {
    if (processedSessionIds.has(sessionId)) return;
    processedSessionIds.add(sessionId);
    try {
      const res = await api<{ session_token: string; user: User }>("/auth/session", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      });
      await setToken(res.session_token);
      setUser(res.user);
    } catch (e) {
      console.warn("session exchange failed", e);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: User }>("/auth/me");
      setUser(res.user);
    } catch {
      setUser(null);
      await clearToken();
    }
  }, []);

  useEffect(() => {
    // On web: session_id may be in URL hash/query
    (async () => {
      try {
        if (Platform.OS === "web") {
          const href = typeof window !== "undefined" ? window.location.href : "";
          const sid = extractSessionId(href);
          if (sid) {
            await exchange(sid);
            // clean URL
            try {
              const url = new URL(window.location.href);
              url.hash = "";
              url.searchParams.delete("session_id");
              window.history.replaceState(window.history.state, "", url.toString());
            } catch {}
          }
        } else {
          const initial = await Linking.getInitialURL();
          const sid = extractSessionId(initial) || extractSessionId(linkListenerCapturedUrl.current);
          if (sid) await exchange(sid);
        }
      } catch {}
      await refresh();
      setLoading(false);
    })();

    const sub = Linking.addEventListener("url", (evt) => {
      linkListenerCapturedUrl.current = evt.url;
      const sid = extractSessionId(evt.url);
      if (sid) exchange(sid);
    });
    return () => sub.remove();
  }, [exchange, refresh]);

  const signIn = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? (typeof window !== "undefined" ? window.location.origin + "/" : "/")
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    try {
      const result: any = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let url: string | null = result?.url ?? null;
      if (!url) url = linkListenerCapturedUrl.current;
      if (!url) url = await Linking.getInitialURL();
      const sid = extractSessionId(url);
      if (sid) await exchange(sid);
    } catch (e) {
      console.warn("openAuthSession error", e);
    }
  }, [exchange]);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refresh, setUser }),
    [user, loading, signIn, signOut, refresh],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
