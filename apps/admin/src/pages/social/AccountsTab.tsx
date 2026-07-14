import { useState } from "react";
import { Plug, Plus, Trash2, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useSocialAccounts,
  useConnectAccount,
  useRevokeAccount,
  PLATFORM_META,
  ALL_PLATFORMS,
  type SocialPlatform,
  type SocialAccount,
} from "@/lib/social-api";
import { Labelled, TextInput } from "./parts";

/**
 * Accounts — a plain handle registry (no OAuth). Social Studio never
 * publishes anything; this only anchors what "your brand's real handle"
 * looks like, so a pasted proof link's author can be sanity-checked against it.
 */
export function AccountsTab() {
  const { can } = useAuthStore();
  const accountsQ = useSocialAccounts();
  const revoke = useRevokeAccount();
  const [connecting, setConnecting] = useState(false);
  const accounts = accountsQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">
          The brand's real handles per platform — used to flag a proof link that
          doesn't look like it came from your account.
        </p>
        {can("social", "create") && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setConnecting(true)}
          >
            Add handle
          </Button>
        )}
      </div>
      <Card className="p-0 overflow-hidden">
        {accountsQ.isLoading ? (
          <div className="p-5">
            <Skeleton style={{ height: 18, width: "40%" }} />
          </div>
        ) : accounts.length === 0 ? (
          <p className="p-6 text-center text-[12.5px] text-text-faint italic">
            No handles registered yet.
          </p>
        ) : (
          accounts.map((a: SocialAccount, i) => (
            <div
              key={a.account_id}
              className={`p-4 flex items-center gap-3 ${
                i < accounts.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-panel-2 text-accent-glow border border-line text-[11px] font-bold uppercase">
                {(PLATFORM_META[a.platform]?.label ?? a.platform).slice(0, 2)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] truncate">@{a.handle}</div>
                <div className="text-[11.5px] text-text-faint">
                  {PLATFORM_META[a.platform]?.label ?? a.platform}
                  {a.profile_url && (
                    <>
                      {" · "}
                      <a
                        href={a.profile_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-glow hover:underline"
                      >
                        view profile
                      </a>
                    </>
                  )}
                </div>
              </div>
              {can("social", "delete") && (
                <button
                  onClick={() => {
                    if (window.confirm(`Remove @${a.handle}?`))
                      revoke.mutate(a.account_id);
                  }}
                  className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
                </button>
              )}
            </div>
          ))
        )}
      </Card>
      {connecting && <ConnectAccountDrawer onClose={() => setConnecting(false)} />}
    </div>
  );
}

function ConnectAccountDrawer({ onClose }: { onClose: () => void }) {
  const connect = useConnectAccount();
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [handle, setHandle] = useState("");
  const [profileUrl, setProfileUrl] = useState("");

  return (
    <Drawer open onClose={onClose} title="Add handle" subtitle="Register a brand-owned account">
      <div className="space-y-4 p-1">
        <Labelled label="Platform">
          <Select
            value={platform}
            onChange={(v) => setPlatform(v)}
            options={ALL_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].label }))}
          />
        </Labelled>
        <Labelled label="Handle">
          <TextInput value={handle} onChange={setHandle} placeholder="pixiegirlglobal" prefix="@" />
        </Labelled>
        <Labelled label="Profile URL (optional)">
          <TextInput
            value={profileUrl}
            onChange={setProfileUrl}
            placeholder="https://instagram.com/pixiegirlglobal"
            mono
          />
        </Labelled>
        {connect.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t add that handle. Check it isn&rsquo;t already registered.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!handle || connect.isPending}
            onClick={() =>
              connect.mutate(
                { platform, handle, profile_url: profileUrl || undefined },
                { onSuccess: onClose },
              )
            }
            icon={connect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          >
            Add
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
