import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, User, CalendarClock, Hash, KeyRound } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { uploadAvatar } from "@/lib/auth-api";

export const ACCOUNT_MENU_ITEMS = [
  { key: "photo", label: "Change photo", icon: Camera },
  { key: "profile", label: "My profile", icon: User },
  { key: "hr", label: "My HR", icon: CalendarClock },
  { key: "pin", label: "Quick login PIN", icon: Hash },
  { key: "password", label: "Change password", icon: KeyRound },
] as const;

/** Shared state + handlers behind the account dropdown (Change photo / My
 *  profile / My HR / Quick login PIN / Change password / Sign out) so both
 *  the desktop sidebar footer and the mobile top-bar avatar open the same
 *  menu instead of the mobile one jumping straight to a single screen. */
export function useAccountMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [pinOpen, setPinOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onItem = (key: string) => {
    if (key === "photo") fileInputRef.current?.click();
    else if (key === "profile") setProfileOpen(true);
    else if (key === "hr") navigate("/hr");
    else if (key === "pin") setPinOpen(true);
    else if (key === "password") setPasswordOpen(true);
  };

  const onSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const handleAvatarDone = async (blob: Blob) => {
    setCropFile(null);
    try {
      const { avatar_url } = await uploadAvatar(blob);
      patchUser({ avatarUrl: avatar_url });
    } catch {
      // silent — the profile drawer shows proper feedback
    }
  };

  return {
    user,
    fileInputRef,
    cropFile,
    setCropFile,
    pinOpen,
    setPinOpen,
    passwordOpen,
    setPasswordOpen,
    profileOpen,
    setProfileOpen,
    onItem,
    onSignOut,
    handleAvatarDone,
  };
}

export type UseAccountMenu = ReturnType<typeof useAccountMenu>;
