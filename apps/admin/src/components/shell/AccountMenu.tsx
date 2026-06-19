import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronUp,
  Camera,
  User,
  CalendarClock,
  Hash,
  KeyRound,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { uploadAvatar } from "@/lib/auth-api";
import { PinManager } from "@/components/auth/PinManager";
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { PhotoCropModal } from "@/components/profile/PhotoCropModal";

const ITEMS = [
  { key: "photo", label: "Change photo", icon: Camera },
  { key: "profile", label: "My profile", icon: User },
  { key: "hr", label: "My HR", icon: CalendarClock },
  { key: "pin", label: "Quick login PIN", icon: Hash },
  { key: "password", label: "Change password", icon: KeyRound },
];

export function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const patchUser = useAuthStore((s) => s.patchUser);
  const [open, setOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onItem = (key: string) => {
    setOpen(false);
    if (key === "photo") fileInputRef.current?.click();
    else if (key === "profile") setProfileOpen(true);
    else if (key === "hr") navigate("/hr");
    else if (key === "pin") setPinOpen(true);
    else if (key === "password") setPasswordOpen(true);
  };

  const onSignOut = async () => {
    setOpen(false);
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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!user) return null;

  const av = initials(user.name);
  const displayAvatar = user.avatarUrl ?? null;

  return (
    <>
      <div className="relative border-t hairline" ref={ref}>
        {open && (
          <div
            className={cn(
              "absolute z-[65] mb-2 bottom-full p-2 rounded-[15px] dropglass animate-fade-in",
              collapsed ? "left-3 w-[230px]" : "left-3 right-3",
            )}
          >
            <div className="flex items-center gap-[11px] p-[10px_10px_12px] border-b hairline mb-1.5">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))] grid place-items-center shrink-0">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt={user.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-display font-semibold text-white text-[14px]">
                    {av}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-[13.5px] truncate">
                  {user.name}
                </div>
                <div className="text-[11px] text-text-faint truncate">
                  {user.email}
                </div>
              </div>
            </div>
            {ITEMS.map((it) => (
              <button
                key={it.key}
                onClick={() => onItem(it.key)}
                className="w-full flex items-center gap-[11px] p-[9px_10px] rounded-[10px] text-[13px] font-medium text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-all"
              >
                <it.icon className="w-4 h-4" />
                {it.label}
              </button>
            ))}
            <div className="h-px bg-line/30 my-1.5 mx-1" />
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-[11px] p-[9px_10px] rounded-[10px] text-[13px] font-medium text-danger hover:bg-danger/10 transition-all"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "w-full flex items-center gap-[11px] p-[12px_14px] cursor-pointer transition-colors hover:bg-text-primary/[0.04]",
            collapsed && "justify-center",
          )}
        >
          <div className="w-9 h-9 rounded-full overflow-hidden bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))] grid place-items-center shrink-0">
            {displayAvatar ? (
              <img
                src={displayAvatar}
                alt={user.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-display font-semibold text-white text-[13px]">
                {av}
              </span>
            )}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 min-w-0 text-left">
                <span className="block font-semibold text-[13px] truncate">
                  {user.name}
                </span>
                <span className="block text-[10px] text-text-faint">
                  {user.role}
                </span>
              </span>
              <ChevronUp
                className={cn(
                  "w-[15px] text-text-faint transition-transform",
                  !open && "rotate-180",
                )}
              />
            </>
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setCropFile(f);
            e.target.value = "";
          }
        }}
      />

      {cropFile && (
        <PhotoCropModal
          file={cropFile}
          onDone={handleAvatarDone}
          onCancel={() => setCropFile(null)}
        />
      )}

      <PinManager open={pinOpen} onClose={() => setPinOpen(false)} />
      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
      <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
