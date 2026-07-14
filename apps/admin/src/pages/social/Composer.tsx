import { useState } from "react";
import { Send, FileText, CalendarDays, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useSocialAccounts,
  useCreatePost,
  useAssignableStaff,
  PLATFORM_META,
  ALL_PLATFORMS,
  POST_TYPES,
  type SocialPlatform,
  type PostType,
} from "@/lib/social-api";
import { Labelled, TextInput, ProductTagPicker, toLocalInput } from "./parts";
import { formatDate } from "@/lib/format";

type Mode = "draft" | "schedule" | "assign";
const MODES: { key: Mode; label: string; icon: React.ReactNode }[] = [
  { key: "draft", label: "Save draft", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-3.5 h-3.5" /> },
  { key: "assign", label: "Assign to creator", icon: <UserPlus className="w-3.5 h-3.5" /> },
];

/**
 * Quick single-post composer — for an ad-hoc post outside a content plan
 * (a draft to flesh out later, or the CEO handing one specific day to a
 * creator). Planning a whole month at once is the Board tab's bulk grid.
 */
export function Composer({
  initialDate,
  onClose,
}: {
  initialDate?: Date;
  onClose: () => void;
}) {
  const accountsQ = useSocialAccounts();
  const staffQ = useAssignableStaff();
  const create = useCreatePost();
  const accounts = accountsQ.data ?? [];

  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [postType, setPostType] = useState<PostType>("image");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [mediaUrls, setMediaUrls] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [scheduledFor, setScheduledFor] = useState(() =>
    initialDate ? toLocalInput(initialDate, 9) : "",
  );
  const [mode, setMode] = useState<Mode>(initialDate ? "schedule" : "draft");

  const charLimit = PLATFORM_META[platform]?.charLimit ?? 2200;
  const overLimit = caption.length > charLimit;
  const canSubmit =
    !overLimit && (mode !== "schedule" || !!scheduledFor) && (mode !== "assign" || !!assignedTo);

  async function submit() {
    const base = {
      platform,
      post_type: postType,
      caption: caption || undefined,
      hashtags: hashtags
        .split(/[\s,]+/)
        .map((h) => h.replace(/^#/, ""))
        .filter(Boolean),
      media_urls: mediaUrls.split(/\s+/).filter(Boolean),
      tagged_product_ids: tags,
    };
    try {
      if (mode === "assign") {
        await create.mutateAsync({
          ...base,
          assigned_to: assignedTo,
          scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
          status: "assigned",
        });
      } else if (mode === "schedule") {
        await create.mutateAsync({
          ...base,
          scheduled_for: new Date(scheduledFor).toISOString(),
        });
      } else {
        await create.mutateAsync({ ...base, status: "draft" });
      }
      onClose();
    } catch {
      /* surfaced via create.isError below */
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="New post"
      subtitle={initialDate ? formatDate(initialDate) : "Compose a single post"}
    >
      <div className="space-y-4 p-1">
        <Labelled label="Platform">
          <Select
            value={platform}
            onChange={setPlatform}
            options={ALL_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].label }))}
          />
        </Labelled>

        {accounts.length > 1 && (
          <p className="text-[11.5px] text-text-faint">
            Posts from your only connected {PLATFORM_META[platform].label} account automatically.
          </p>
        )}
        {accounts.filter((a) => a.platform === platform).length === 0 && (
          <p className="text-[12px] text-warn">
            No {PLATFORM_META[platform].label} account connected — connect one in the Accounts tab first.
          </p>
        )}

        <Labelled label="Post type">
          <Select
            value={postType}
            onChange={(v) => setPostType(v as PostType)}
            options={POST_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))}
          />
        </Labelled>

        <Labelled label="Caption">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            placeholder="Write your caption…"
            className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
          />
          <div className={`text-[11px] mt-1 text-right ${overLimit ? "text-danger" : "text-text-faint"}`}>
            {caption.length} / {charLimit}
          </div>
        </Labelled>

        <Labelled label="Hashtags">
          <TextInput value={hashtags} onChange={setHashtags} placeholder="#luxe #hair #lagos" />
        </Labelled>

        <Labelled label="Media URLs (space-separated)">
          <TextInput value={mediaUrls} onChange={setMediaUrls} placeholder="https://… https://…" mono />
        </Labelled>

        <Labelled label="Tagged products (optional)">
          <ProductTagPicker value={tags} onChange={setTags} />
        </Labelled>

        <Labelled label="When">
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map((m) => {
              const on = mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={`inline-flex flex-col items-center justify-center gap-1 h-[46px] rounded-[10px] text-[11.5px] font-semibold border transition-colors ${
                    on
                      ? "border-accent/50 text-accent-glow bg-accent/[0.12]"
                      : "border-line text-text-muted hover:text-text-primary"
                  }`}
                >
                  {m.icon}
                  {m.label}
                </button>
              );
            })}
          </div>
        </Labelled>

        {(mode === "schedule" || mode === "assign") && (
          <Labelled label="Scheduled date & time">
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
            />
          </Labelled>
        )}

        {mode === "assign" && (
          <Labelled label="Assign to">
            <Select
              value={assignedTo}
              onChange={setAssignedTo}
              options={(staffQ.data ?? []).map((s) => ({ value: s.user_id, label: s.display_name }))}
            />
          </Labelled>
        )}

        {create.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t save the post.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          >
            {MODES.find((m) => m.key === mode)!.label}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
