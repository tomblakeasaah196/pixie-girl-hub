import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Copy, Store, Info } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useActiveBusiness } from "@/stores/business";

interface Props {
  onClose: () => void;
}

/**
 * Walk-in QR code modal. Staff shows this QR code at the counter.
 * Customer scans → fills name + phone + email + birthday (month/day) on the public walk-in form.
 * New contact appears in real-time on the Contacts directory via Socket.io.
 */
export function WalkInQR({ onClose }: Props) {
  const business = useActiveBusiness();
  const svgRef = useRef<HTMLDivElement>(null);

  // Walk-in URL: points to the public storefront registration page for this brand.
  // The storefront will POST to /api/v1/public/walkin (or similar public endpoint).
  const walkinUrl = `${window.location.origin}/walkin/${business.key}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walkinUrl);
    } catch {
      // Clipboard not available — silent
    }
  };

  const handleDownload = () => {
    const svg = svgRef.current?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `walkin-qr-${business.key}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Store className="w-4 h-4 text-accent" />
          Walk-in QR · {business.name}
        </span>
      }
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy className="w-3.5 h-3.5" />}
            onClick={handleCopy}
          >
            Copy URL
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handleDownload}
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
        {/* QR Code */}
        <div
          ref={svgRef}
          className="p-5 rounded-[20px] bg-white shadow-glass"
        >
          <QRCodeSVG
            value={walkinUrl}
            size={200}
            level="M"
            marginSize={1}
            fgColor="#0F0809"
            bgColor="#FFFFFF"
          />
        </div>

        {/* Business name */}
        <div className="text-center">
          <div className="font-display text-lg text-text-primary">{business.name}</div>
          <div className="text-[12px] text-text-faint mt-0.5">Walk-in Registration</div>
        </div>

        {/* URL preview */}
        <div className="w-full px-3 py-2 rounded-[10px] bg-text-primary/[0.04] border hairline">
          <p className="text-[11px] font-mono text-text-faint break-all text-center">
            {walkinUrl}
          </p>
        </div>

        {/* Instructions */}
        <div className="w-full p-3 rounded-[12px] bg-info/[0.08] border border-info/20">
          <div className="flex gap-2.5">
            <Info className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[12px] font-semibold text-text-primary mb-1.5">
                How it works
              </div>
              <ul className="text-[11.5px] text-text-muted space-y-1">
                <li>• Customer scans the QR with their phone camera</li>
                <li>• Fills in: name, phone, email, and birthday (month + day)</li>
                <li>• Their contact card appears on your screen in real-time</li>
                <li>• Birthday reminders fire automatically each year</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Print tip */}
        <p className="text-[11px] text-text-faint text-center">
          Print and place at your counter, or share the URL directly.
        </p>
      </div>
    </Modal>
  );
}
