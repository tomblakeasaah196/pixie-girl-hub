/**
 * RichMailEditor — the Gmail-style mail writer for Marketing templates.
 *
 * The marketing officer just writes: bold/italic/underline, brand colours,
 * text size, alignment, lists, links, images (uploaded, not URLs), emoji, and
 * a "Personalise" menu that drops friendly pills like “First name” into the
 * text. No HTML, no modes, no tokens on screen.
 *
 * Storage contract: the editor's value is plain HTML whose personalisation
 * pills are serialized to `{{token}}` merge tags (what the send pipeline
 * substitutes). `htmlToEditor`/`editorToHtml` convert in both directions, so
 * a re-opened template shows pills again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Link2,
  Link2Off,
  ImagePlus,
  Loader2,
  Smile,
  UserRound,
  ChevronDown,
  Palette,
  Undo2,
  Redo2,
  Type,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EmojiPicker } from "@/components/messaging/EmojiPicker";
import { useBrandPalette } from "@/lib/brand-colors";
import { TEMPLATE_VARIABLES } from "@/lib/marketing-api";

// ── Personalisation pills ───────────────────────────────────

const TOKEN_LABELS: Record<string, string> = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.token.replace(/[{}]/g, ""), v.label]),
);

/** An inline, atomic “First name”-style pill that stands for a merge token. */
const TokenPill = TiptapNode.create({
  name: "tokenPill",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { token: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-token]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const token = String(node.attrs.token || "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-token": token,
        class: "pgh-token-pill",
      }),
      TOKEN_LABELS[token] || token,
    ];
  },
});

/** Stored HTML (`{{token}}`) → editor HTML (pill spans). */
function htmlToEditor(html: string): string {
  return String(html || "").replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_m, token) => `<span data-token="${token}"></span>`,
  );
}

/** Editor HTML (pill spans) → stored HTML (`{{token}}` merge tags). */
function editorToHtml(html: string): string {
  return String(html || "")
    .replace(
      /<span[^>]*data-token="([\w.]+)"[^>]*>.*?<\/span>/g,
      (_m, token) => `{{${token}}}`,
    )
    .replace(/<p><\/p>/g, "<p><br/></p>");
}

// ── Toolbar bits ────────────────────────────────────────────

function ToolBtn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid place-items-center w-8 h-8 rounded-lg transition-colors disabled:opacity-30",
        active
          ? "bg-accent/[0.16] text-accent-glow"
          : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-line mx-0.5 shrink-0" aria-hidden />;
}

const FONT_SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "" },
  { label: "Large", value: "18px" },
  { label: "Huge", value: "24px" },
];

/** Close-on-outside-click popover under a toolbar button. */
function Popover({
  onClose,
  children,
  align = "left",
}: {
  onClose: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={cn(
        "absolute top-full mt-1.5 z-30 dropglass rounded-xl border border-line shadow-xl p-2 min-w-[210px]",
        align === "right" ? "right-0" : "left-0",
      )}
    >
      {children}
    </div>
  );
}

// ── The editor ──────────────────────────────────────────────

export function RichMailEditor({
  value,
  onChange,
  placeholder = "Write your mail…",
  personalise = true,
  uploadEndpoint = "/email-campaigns/upload-image",
  compact = false,
  autoFocus = false,
  onSubmit,
}: {
  /** Stored HTML with {{token}} merge tags. */
  value: string;
  onChange: (storedHtml: string) => void;
  placeholder?: string;
  /** Show the "Personalise" merge-token menu. Off for 1:1 messaging, where
   *  there are no campaign merge tags to fill in. */
  personalise?: boolean;
  /** Where inline images upload to (returns `{ url }`). Marketing keeps the
   *  default; Messaging points at its own endpoint. */
  uploadEndpoint?: string;
  /** Slimmer writing surface for the messaging composers. */
  compact?: boolean;
  /** Focus the editor on mount. */
  autoFocus?: boolean;
  /** Fired on Cmd/Ctrl+Enter — lets a composer send without leaving the
   *  keyboard while plain Enter still makes a new line (Gmail-style). */
  onSubmit?: () => void;
}) {
  const palette = useBrandPalette();
  const [menu, setMenu] = useState<
    null | "personalise" | "emoji" | "color" | "size"
  >(null);
  const [customHex, setCustomHex] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Track the last HTML we emitted so the value-sync effect can tell an
  // external replacement (a Praxis draft, a quick reply, a post-send clear)
  // apart from the echo of the operator's own typing.
  const lastEmitted = useRef(value);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
        },
      }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
      TokenPill,
    ],
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
    },
    content: htmlToEditor(value),
    onUpdate: ({ editor: ed }) => {
      const html = editorToHtml(ed.getHTML());
      lastEmitted.current = html;
      onChange(html);
    },
  });

  // Reflect external `value` replacements into the editor (the parent driving
  // content in — insertions, clear-after-send). Guarded against our own
  // emissions so typing is never clobbered mid-keystroke.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    const current = editorToHtml(editor.getHTML());
    if (value !== current) {
      editor.commands.setContent(htmlToEditor(value), { emitUpdate: false });
    }
    lastEmitted.current = value;
  }, [value, editor]);

  const insertToken = useCallback(
    (token: string) => {
      editor
        ?.chain()
        .focus()
        .insertContent({ type: "tokenPill", attrs: { token } })
        .run();
      setMenu(null);
    },
    [editor],
  );

  const setLink = useCallback(() => {
    if (!editor) return;
    const current = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(
      "Link to (e.g. pixiegirlglobal.com/sale)",
      current || "",
    );
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }, [editor]);

  const pickImage = useCallback(() => fileRef.current?.click(), []);
  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !editor) return;
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const { url } = await api.postForm<{ url: string }>(
          uploadEndpoint,
          form,
        );
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch {
        window.alert("Couldn't upload the image — try again.");
      } finally {
        setUploading(false);
      }
    },
    [editor, uploadEndpoint],
  );

  if (!editor) return null;

  const applyColor = (hex: string) => {
    editor.chain().focus().setColor(hex).run();
    setMenu(null);
  };

  return (
    <div className="rounded-[13px] border border-line bg-text-primary/[0.03] focus-within:border-accent/50 overflow-visible">
      {/* Toolbar */}
      <div className="relative flex items-center gap-0.5 flex-wrap px-1.5 py-1.5 border-b border-line">
        <ToolBtn
          title="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo2 className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo2 className="w-4 h-4" />
        </ToolBtn>
        <Divider />
        <ToolBtn
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="w-4 h-4" />
        </ToolBtn>

        {/* Colour (brand palette + custom hex) */}
        <div className="relative">
          <ToolBtn
            title="Text colour"
            active={menu === "color"}
            onClick={() => setMenu(menu === "color" ? null : "color")}
          >
            <Palette className="w-4 h-4" />
          </ToolBtn>
          {menu === "color" && (
            <Popover onClose={() => setMenu(null)}>
              <div className="micro px-1 pb-1.5">Brand colours</div>
              <div className="space-y-0.5 max-h-56 overflow-y-auto">
                {palette.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyColor(c.hex)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[12.5px] text-text-primary hover:bg-text-primary/[0.06] text-left"
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-line shrink-0"
                      style={{ background: c.hex }}
                    />
                    <span className="flex-1 truncate">{c.label}</span>
                    <span className="font-mono text-[10.5px] text-text-faint">
                      {c.hex}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-line flex items-center gap-1.5 px-1">
                <input
                  value={customHex}
                  onChange={(e) => setCustomHex(e.target.value.trim())}
                  placeholder="#a35d2e"
                  className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-text-primary/[0.05] border border-line text-[12px] font-mono outline-none focus:border-accent/50"
                />
                <button
                  type="button"
                  disabled={!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(customHex)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor(customHex)}
                  className="h-8 px-2.5 rounded-lg text-[12px] font-semibold text-accent-glow bg-accent/[0.12] disabled:opacity-40"
                >
                  Use
                </button>
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().unsetColor().run();
                  setMenu(null);
                }}
                className="mt-1.5 w-full px-2 py-1.5 rounded-lg text-[12px] text-text-muted hover:bg-text-primary/[0.06] text-left"
              >
                Reset to default
              </button>
            </Popover>
          )}
        </div>

        {/* Text size */}
        <div className="relative">
          <ToolBtn
            title="Text size"
            active={menu === "size"}
            onClick={() => setMenu(menu === "size" ? null : "size")}
          >
            <Type className="w-4 h-4" />
          </ToolBtn>
          {menu === "size" && (
            <Popover onClose={() => setMenu(null)}>
              {FONT_SIZES.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const chain = editor.chain().focus();
                    if (f.value) chain.setFontSize(f.value).run();
                    else chain.unsetFontSize().run();
                    setMenu(null);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg text-text-primary hover:bg-text-primary/[0.06] text-left"
                  style={{ fontSize: f.value || "15px" }}
                >
                  {f.label}
                </button>
              ))}
              <div className="mt-1 pt-1 border-t border-line">
                {[1, 2].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .toggleHeading({ level: level as 1 | 2 })
                        .run();
                      setMenu(null);
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 rounded-lg hover:bg-text-primary/[0.06] text-left font-display",
                      editor.isActive("heading", { level })
                        ? "text-accent-glow"
                        : "text-text-primary",
                    )}
                    style={{ fontSize: level === 1 ? 19 : 16 }}
                  >
                    Heading {level}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        <Divider />
        <ToolBtn
          title="Align left"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Align centre"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Align right"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="w-4 h-4" />
        </ToolBtn>
        <Divider />
        <ToolBtn
          title="Bulleted list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="w-4 h-4" />
        </ToolBtn>
        <Divider />
        <ToolBtn
          title={editor.isActive("link") ? "Edit link" : "Add link"}
          active={editor.isActive("link")}
          onClick={setLink}
        >
          <Link2 className="w-4 h-4" />
        </ToolBtn>
        {editor.isActive("link") && (
          <ToolBtn
            title="Remove link"
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Link2Off className="w-4 h-4" />
          </ToolBtn>
        )}
        <ToolBtn title="Insert image" onClick={pickImage} disabled={uploading}>
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ImagePlus className="w-4 h-4" />
          )}
        </ToolBtn>

        {/* Emoji */}
        <div className="relative">
          <ToolBtn
            title="Emoji"
            active={menu === "emoji"}
            onClick={() => setMenu(menu === "emoji" ? null : "emoji")}
          >
            <Smile className="w-4 h-4" />
          </ToolBtn>
          {menu === "emoji" && (
            <div className="absolute top-full mt-1.5 z-30 left-1/2 -translate-x-1/2">
              <EmojiPicker
                onPick={(emoji) => {
                  editor.chain().focus().insertContent(emoji).run();
                }}
                onClose={() => setMenu(null)}
              />
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Personalise */}
        {personalise && (
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === "personalise" ? null : "personalise")}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-colors",
              menu === "personalise"
                ? "bg-accent/[0.16] text-accent-glow"
                : "text-accent-glow/90 hover:bg-accent/[0.1]",
            )}
          >
            <UserRound className="w-3.5 h-3.5" />
            Personalise
            <ChevronDown className="w-3 h-3" />
          </button>
          {menu === "personalise" && (
            <Popover onClose={() => setMenu(null)} align="right">
              <div className="micro px-1 pb-1.5">
                Fills in for each customer
              </div>
              {TEMPLATE_VARIABLES.filter((v) => v.group === "recipient").map(
                (v) => (
                  <PersonaliseItem key={v.token} v={v} onPick={insertToken} />
                ),
              )}
              <div className="micro px-1 pt-2 pb-1.5 border-t border-line mt-1.5">
                From the campaign&rsquo;s sale details
              </div>
              {TEMPLATE_VARIABLES.filter((v) => v.group === "sale").map((v) => (
                <PersonaliseItem key={v.token} v={v} onPick={insertToken} />
              ))}
            </Popover>
          )}
        </div>
        )}
      </div>

      {/* Writing surface */}
      <EditorContent
        editor={editor}
        className={cn("pgh-mail-editor", compact && "pgh-mail-editor--compact")}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={onFile}
        className="hidden"
      />
    </div>
  );
}

function PersonaliseItem({
  v,
  onPick,
}: {
  v: (typeof TEMPLATE_VARIABLES)[number];
  onPick: (token: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(v.token.replace(/[{}]/g, ""))}
      className="w-full px-2 py-1.5 rounded-lg text-[12.5px] text-text-primary hover:bg-text-primary/[0.06] text-left"
    >
      {v.label}
    </button>
  );
}

/** Sanity check an editor instance exists (narrow type for callers). */
export type MailEditor = Editor;
