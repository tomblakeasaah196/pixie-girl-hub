import { PinManager } from "@/components/auth/PinManager";
import { ChangePasswordModal } from "@/components/auth/ChangePasswordModal";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { PhotoCropModal } from "@/components/profile/PhotoCropModal";
import { toViewableImage } from "@/lib/heic";
import type { UseAccountMenu } from "./useAccountMenu";

/** The hidden file input + modals a `useAccountMenu()` dropdown opens into —
 *  shared by every trigger (sidebar footer, mobile top-bar avatar) so there's
 *  one PinManager/ChangePasswordModal/ProfileDrawer mount, not one per menu. */
export function AccountMenuModals({ menu }: { menu: UseAccountMenu }) {
  const {
    fileInputRef,
    cropFile,
    setCropFile,
    handleAvatarDone,
    pinOpen,
    setPinOpen,
    passwordOpen,
    setPasswordOpen,
    profileOpen,
    setProfileOpen,
  } = menu;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setCropFile(await toViewableImage(f));
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
