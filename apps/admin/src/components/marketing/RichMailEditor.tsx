/**
 * RichMailEditor — the Gmail-style mail writer shared by Marketing templates
 * and the Retention strategy builder (one editor, one token vocabulary).
 *
 * The writer just writes: bold/italic/underline, brand colours, text size,
 * alignment, lists, links, images (uploaded, not URLs), emoji, and a
 * "Personalise" menu that drops friendly pills like “First name” or “Points
 * balance” into the text — plus the owner's own custom tokens, addable inline
 * right inside the menu. No HTML, no modes, no tokens on screen.
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
import {
  Node as TiptapNode,
  Extension,
  mergeAttributes,
} from "@tiptap/core";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalSpaceAround,
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
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EmojiPicker } from "@/components/messaging/EmojiPicker";
import { useBrandPalette } from "@/lib/brand-colors";
import { useAuthStore } from "@/stores/auth";
import {
  PERSONALISE_TOKENS,
  SCOPE_GROUPS,
  tokenLabel,
  registerTokenLabels,
  useCustomTokens,
  useSaveCustomTokens,
  CUSTOM_TOKEN_RE,
  isReservedToken,
  type TokenScope,
  type CustomToken,
} from "@/lib/personalise";

// ── Personalisation pills ───────────────────────────────────

/** An inline, atomic “First name”-style pill that stands for a merge token. */
const TokenPill = TiptapNode.create({
  name: "tokenPill",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    // Persist the token in `data-token` in BOTH directions. Without an explicit
    // parseHTML, TipTap reads the attribute named `token`, but stored mail (and
    // htmlToEditor) only carries `data-token` — so on reload/setContent the pill
    // parsed back with an empty token and rendered as a blank chip (the stray
    // "underscore" pill). renderHTML here is a no-op because the node's own
    // renderHTML already emits data-token; this just fixes the read side.
    return {
      token: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-token") || "",
        renderHTML: () => ({}),
      },
    };
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
      tokenLabel(token),
    ];
  },
});

// ── Paragraph spacing (Word-style "Line spacing") ───────────
//
// Marks whole paragraphs "tight" or "relaxed" so a signature block can sit
// close and body copy can breathe. Stored as a `data-space` attribute on the
// <p> (nothing on screen); the editor CSS renders it live, and the mail
// renderer + preview map it to real margins so the sent email matches.

export type ParagraphSpace = "tight" | "relaxed";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphSpacing: {
      /** Apply a spacing to every paragraph in the selection (null = normal). */
      setParagraphSpacing: (space: ParagraphSpace | null) => ReturnType;
    };
  }
}

const ParagraphSpacing = Extension.create({
  name: "paragraphSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          dataSpace: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-space") || null,
            renderHTML: (attrs) =>
              attrs.dataSpace ? { "data-space": attrs.dataSpace } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      // Applies to every paragraph touched by the selection — "select three
      // lines, tap once, all three change" — not just the one at the cursor.
      setParagraphSpacing:
        (space) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let touched = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === "paragraph") {
              tr.setNodeAttribute(pos, "dataSpace", space);
              touched = true;
            }
          });
          if (touched && dispatch) dispatch(tr);
          return touched;
        },
    };
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
  // The click only runs if a real pointer/keyboard gesture landed on this
  // button first. After a user clicks back into the editor from another
  // control, Chromium can synthesise a trusted click on whichever toolbar
  // button React just restored focus to during the commit — with no
  // pointerdown/mousedown of its own — which was silently firing Undo/Redo
  // and eating the just-typed text. We ignore that phantom click.
  const armed = useRef(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onPointerDown={() => {
        armed.current = true;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") armed.current = true;
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (!armed.current) {
          e.preventDefault();
          return;
        }
        armed.current = false;
        onClick();
      }}
      className={cn(
        // Real thumb targets on touch screens; the tighter 32px grid on desktop.
        "grid place-items-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg transition-colors disabled:opacity-30",
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

/** Line-spacing menu. `key` matches the paragraph's data-space ("normal" = the
 *  default, stored as no attribute); `value` is what the command applies. */
const SPACING_OPTIONS: {
  key: string;
  value: ParagraphSpace | null;
  label: string;
  hint: string;
}[] = [
  { key: "tight", value: "tight", label: "Tight", hint: "Close together — great for a signature" },
  { key: "normal", value: null, label: "Normal", hint: "The default" },
  { key: "relaxed", value: "relaxed", label: "Relaxed", hint: "More room to breathe" },
];

/** Close-on-outside-click popover under a toolbar button. Height-capped and
 *  internally scrollable so it can NEVER run off the bottom of a phone
 *  screen — long lists (Personalise) scroll inside it instead. */
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
        "absolute top-full mt-1.5 z-30 dropglass rounded-xl border border-line shadow-xl p-2 min-w-[210px] max-w-[calc(100vw-2rem)]",
        "max-h-[min(440px,60vh)] overflow-y-auto overscroll-contain",
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
  tokenScope = "campaign",
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
  /** Which token groups the Personalise menu offers: "campaign" adds the
   *  sale tokens; "retention" is customer + loyalty only. */
  tokenScope?: TokenScope;
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
    null | "personalise" | "emoji" | "color" | "size" | "spacing"
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
  // Remember where the caret is. On touch devices the toolbar's focus-preserving
  // `mousedown` handler fires *after* the tap has already blurred the editor, so
  // its live DOM selection is gone by the time a Personalise pick runs — a plain
  // `.focus().insertContent()` then has no caret to land on and silently does
  // nothing. We insert at this remembered position instead, so a pick always lands.
  const caretRef = useRef<{ from: number; to: number } | null>(null);

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
      ParagraphSpacing,
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
    onCreate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      caretRef.current = { from, to };
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      caretRef.current = { from, to };
    },
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
      if (!editor) return;
      // Order matters, and it's the whole bug on iOS WebKit. Every other
      // toolbar op runs `.focus()` FIRST and mutates a focused editor, and
      // they all paint immediately. Mutating a BLURRED editor (tapping the
      // Personalise menu drops focus) and focusing afterwards inserts the
      // node into the document but WebKit doesn't repaint the contenteditable
      // until the next transaction — so the pill was invisible until any
      // other button (e.g. redo) nudged a reflow. Focus first, then insert.
      //
      // We still target the remembered caret explicitly (touch drops the live
      // selection), clamped to the current doc (an external content swap can
      // leave the saved range stale) with an end-of-doc fallback so a pick is
      // never a no-op.
      const size = editor.state.doc.content.size;
      const saved = caretRef.current;
      const from = saved ? Math.min(saved.from, size) : size;
      const to = saved ? Math.min(saved.to, size) : size;
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, { type: "tokenPill", attrs: { token } })
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
            // Reflect an applied size/heading, not just the open menu, so the
            // button lights up like Bold/Italic do once a size is in effect.
            active={
              menu === "size" ||
              !!editor.getAttributes("textStyle").fontSize ||
              editor.isActive("heading")
            }
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

        {/* Line spacing — tighten or loosen the selected paragraphs */}
        <div className="relative">
          <ToolBtn
            title="Line spacing"
            active={menu === "spacing" || !!editor.getAttributes("paragraph").dataSpace}
            onClick={() => setMenu(menu === "spacing" ? null : "spacing")}
          >
            <AlignVerticalSpaceAround className="w-4 h-4" />
          </ToolBtn>
          {menu === "spacing" && (
            <Popover onClose={() => setMenu(null)}>
              <div className="micro px-1 pb-1.5">
                Spacing for the selected lines
              </div>
              {SPACING_OPTIONS.map((opt) => {
                const current =
                  (editor.getAttributes("paragraph").dataSpace as
                    | string
                    | null) ?? "normal";
                const active = current === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .setParagraphSpacing(opt.value)
                        .run();
                      setMenu(null);
                    }}
                    className={cn(
                      "w-full flex flex-col items-start px-2 py-1.5 rounded-lg hover:bg-text-primary/[0.06] text-left",
                      active ? "text-accent-glow" : "text-text-primary",
                    )}
                  >
                    <span className="text-[12.5px] font-medium">{opt.label}</span>
                    <span className="text-[10.5px] text-text-faint">{opt.hint}</span>
                  </button>
                );
              })}
            </Popover>
          )}
        </div>

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

        {/* Personalise */}
        {personalise && (
        <div className="relative ml-auto">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu(menu === "personalise" ? null : "personalise")}
            className={cn(
              "inline-flex items-center gap-1.5 h-9 sm:h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-colors",
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
            <PersonaliseMenu
              scope={tokenScope}
              onPick={insertToken}
              onClose={() => setMenu(null)}
            />
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
  token,
  label,
  onPick,
}: {
  token: string;
  label: string;
  onPick: (token: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(token)}
      className="w-full px-2 py-2 sm:py-1.5 rounded-lg text-[12.5px] text-text-primary hover:bg-text-primary/[0.06] text-left"
    >
      {label}
    </button>
  );
}

/**
 * The grouped Personalise menu: built-in tokens per scope, the brand's own
 * custom tokens, and an inline "Add your own" form. Everything lives INSIDE
 * the scroll-capped popover — nothing ever renders off-screen.
 */
function PersonaliseMenu({
  scope,
  onPick,
  onClose,
}: {
  scope: TokenScope;
  onPick: (token: string) => void;
  onClose: () => void;
}) {
  const { can } = useAuthStore();
  const canManage = can("email_campaigns", "edit");
  const customQ = useCustomTokens();
  const save = useSaveCustomTokens();
  const custom = customQ.data ?? [];

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Custom pills should read as chips ("WhatsApp line"), not code.
  useEffect(() => {
    if (customQ.data?.length) registerTokenLabels(customQ.data);
  }, [customQ.data]);

  const slugged = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  const addToken = async () => {
    setFormError(null);
    if (!CUSTOM_TOKEN_RE.test(slugged)) {
      setFormError("Use letters, numbers and spaces — starting with a letter.");
      return;
    }
    if (isReservedToken(slugged)) {
      setFormError("That name is a built-in token.");
      return;
    }
    if (custom.some((t) => t.token === slugged)) {
      setFormError("You already have that token.");
      return;
    }
    const next: CustomToken = {
      token: slugged,
      label: name.trim() || slugged,
      value: tokenValue.trim(),
    };
    try {
      await save.mutateAsync([...custom, next]);
      registerTokenLabels([next]);
      setName("");
      setTokenValue("");
      setAdding(false);
      onPick(next.token); // drop the new pill straight into the mail
    } catch {
      setFormError("Couldn't save the token — try again.");
    }
  };

  const removeToken = (token: string) => {
    save.mutate(custom.filter((t) => t.token !== token));
  };

  return (
    <Popover onClose={onClose} align="right">
      {SCOPE_GROUPS[scope].map(({ group, heading }, gi) => (
        <div key={group}>
          <div
            className={cn(
              "micro px-1 pb-1.5",
              gi > 0 && "pt-2 border-t border-line mt-1.5",
            )}
          >
            {heading}
          </div>
          {PERSONALISE_TOKENS.filter((v) => v.group === group).map((v) => (
            <PersonaliseItem
              key={v.token}
              token={v.token}
              label={v.label}
              onPick={onPick}
            />
          ))}
        </div>
      ))}

      {/* Your tokens */}
      {(custom.length > 0 || canManage) && (
        <div className="micro px-1 pt-2 pb-1.5 border-t border-line mt-1.5">
          Your tokens
        </div>
      )}
      {custom.map((t) => (
        <div key={t.token} className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            <PersonaliseItem token={t.token} label={t.label} onPick={onPick} />
          </div>
          {canManage && (
            <button
              type="button"
              title={`Remove "${t.label}"`}
              aria-label={`Remove "${t.label}"`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeToken(t.token)}
              disabled={save.isPending}
              className="grid place-items-center w-7 h-7 rounded-md text-text-faint hover:text-danger shrink-0 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* Add your own — inline, inside the scrolling popover */}
      {canManage &&
        (adding ? (
          <div className="mt-1.5 p-2 rounded-lg bg-text-primary/[0.04] border border-line space-y-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token name (e.g. WhatsApp line)"
              autoFocus
              className="w-full h-9 px-2.5 rounded-lg bg-text-primary/[0.05] border border-line text-[12.5px] outline-none focus:border-accent/50"
              autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
            <input
              value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
              placeholder="What it fills in (e.g. +234 800 000 0000)"
              className="w-full h-9 px-2.5 rounded-lg bg-text-primary/[0.05] border border-line text-[12.5px] outline-none focus:border-accent/50"
              autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
            {slugged && (
              <p className="text-[10.5px] text-text-faint font-mono px-0.5">
                {"{{"}{slugged}{"}}"}
              </p>
            )}
            {formError && (
              <p className="text-[11px] text-danger px-0.5">{formError}</p>
            )}
            <div className="flex justify-end gap-1.5 pt-0.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setAdding(false);
                  setFormError(null);
                }}
                className="h-8 px-2.5 rounded-lg text-[12px] text-text-muted hover:bg-text-primary/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={addToken}
                disabled={!name.trim() || save.isPending}
                className="h-8 px-3 rounded-lg text-[12px] font-semibold text-accent-glow bg-accent/[0.12] disabled:opacity-40"
              >
                {save.isPending ? "Adding…" : "Add & insert"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAdding(true)}
            className="mt-1 w-full px-2 py-2 rounded-lg text-[12.5px] font-semibold text-accent-glow hover:bg-accent/[0.08] text-left inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add your own token
          </button>
        ))}
    </Popover>
  );
}

/** Sanity check an editor instance exists (narrow type for callers). */
export type MailEditor = Editor;
