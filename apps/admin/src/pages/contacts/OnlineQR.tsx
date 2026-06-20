import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Copy, Globe, Info, RefreshCw, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useActiveBusiness } from "@/stores/business";
import { onboardingApi } from "@/lib/smartcomm-api";

interface Props {
  onClose: () => void;
}

/**
 * Online QR — a shareable customer-onboarding link (the rich form: IG/WhatsApp
 * handle + delivery address via Google Places + DOB + preferred channel).
 *
 * Unlike the Walk-in QR (a standing counter link), each online link is a
 * single-customer token: generate one, share it (DM / IG bio story / WhatsApp),
 * and the customer fills it once. Hit "New link" to mint a fresh one for the
 * next customer.
 */
export function OnlineQR({ onClose }: Props) {
  const business = useActiveBusiness();
  const svgRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    setLoading(true);
    setError(null);
    try {
      const res = await onboardingApi.createLink({
        business: business.key,
        source: "online",
      });
      setUrl(res.url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not generate a link");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void mint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard unavailable — silent
    }
  };

  const handleDownload = () => {
    const svg = svgRef.current?.querySelector("svg");
    if (!svg) return;
    const data = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `online-qr-${business.key}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-accent" />
          Online QR · {business.name}
        </span>
      }
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={mint}
            disabled={loading}
          >
            New link
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy className="w-3.5 h-3.5" />}
            onClick={handleCopy}
            disabled={!url}
          >
            Copy URL
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handleDownload}
            disabled={!url}
          >
            Download SVG
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-5">
        <div className="p-5 rounded-[20px] bg-white shadow-glass grid place-items-center min-h-[210px] min-w-[210px]">
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin text-[#0F0809]" />
          ) : url ? (
            <div ref={svgRef}>
              <QRCodeSVG
                value={url}
                size={200}
                level="M"
                marginSize={1}
                fgColor="#0F0809"
                bgColor="#FFFFFF"
              />
            </div>
          ) : (
            <span className="text-[12px] text-[#690909]">
              {error ?? "No link"}
            </span>
          )}
        </div>

        <div className="text-center">
          <div className="font-display text-lg text-text-primary">
            {business.name}
          </div>
          <div className="text-[12px] text-text-faint mt-0.5">
            Online onboarding form
          </div>
        </div>

        {url && (
          <div className="w-full px-3 py-2 rounded-[10px] bg-text-primary/[0.04] border hairline">
            <p className="text-[11px] font-mono text-text-faint break-all text-center">
              {url}
            </p>
          </div>
        )}

        <div className="w-full p-3 rounded-[12px] bg-info/[0.08] border border-info/20">
          <div className="flex gap-2.5">
            <Info className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[12px] font-semibold text-text-primary mb-1.5">
                How it works
              </div>
              <ul className="text-[11.5px] text-text-muted space-y-1">
                <li>• Share the link via DM, IG story, or WhatsApp</li>
                <li>
                  • Customer fills IG/WhatsApp handle, delivery address (Google
                  Maps) & birthday
                </li>
                <li>• Their contact card appears in real-time on Contacts</li>
                <li>
                  • Each link is for one customer — hit “New link” for the next
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
