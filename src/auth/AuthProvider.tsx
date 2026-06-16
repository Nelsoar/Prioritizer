import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { AuthScreen } from "./AuthScreen";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  avatarUrl: string | null;
  setAvatarUrl: (url: string) => Promise<void>;
  signOut: () => Promise<void>;
  authReady: boolean;
  supabaseConfigured: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

function avatarFromUser(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata?.avatar_url;
  if (typeof meta === "string" && meta) return meta;
  const local = localStorage.getItem(`profile-avatar-${user.id}`);
  return local || null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [localAvatar, setLocalAvatar] = useState<string | null>(() =>
    localStorage.getItem("profile-avatar-local")
  );
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const fileRef = useRef<HTMLInputElement>(null);

  const avatarUrl = session?.user
    ? avatarFromUser(session.user)
    : localAvatar;

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const setAvatarUrl = async (url: string) => {
    const uid = session?.user?.id;
    if (uid) {
      localStorage.setItem(`profile-avatar-${uid}`, url);
      if (supabase) await supabase.auth.updateUser({ data: { avatar_url: url } });
    } else {
      localStorage.setItem("profile-avatar-local", url);
      setLocalAvatar(url);
    }
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  };

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    avatarUrl,
    setAvatarUrl,
    signOut,
    authReady,
    supabaseConfigured,
  };

  if (supabaseConfigured && authReady && !session) {
    return <AuthScreen />;
  }

  return (
    <AuthContext.Provider value={value}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => void setAvatarUrl(String(fr.result || ""));
          fr.readAsDataURL(f);
          e.currentTarget.value = "";
        }}
      />
      <ProfilePickerContext.Provider value={{ openPicker: () => fileRef.current?.click() }}>
        {children}
      </ProfilePickerContext.Provider>
    </AuthContext.Provider>
  );
}

const ProfilePickerContext = createContext<{ openPicker: () => void }>({ openPicker: () => {} });

export function useProfilePicker() {
  return useContext(ProfilePickerContext);
}
