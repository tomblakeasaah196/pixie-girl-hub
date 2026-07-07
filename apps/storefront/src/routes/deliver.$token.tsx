import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getDriverDelivery,
  confirmDriverDelivery,
  type DriverDelivery,
} from "@/lib/storefront";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/deliver/$token")({ component: DeliverPage });

const TERMINAL = new Set(["delivered", "returned_to_sender", "cancelled", "lost", "damaged"]);

function addressLine(a?: Record<string, unknown> | null): string {
  if (!a) return "";
  return [a.line1, a.area, a.city, a.state, a.country]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(", ");
}

function DeliverPage() {
  const { token } = Route.useParams();
  const q = useQuery({
    queryKey: ["driver-delivery", token],
    queryFn: () => getDriverDelivery(token),
  });

  if (q.isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">Loading delivery…</p>
      </Section>
    );
  if (q.isError || !q.data)
    return (
      <Section>
        <ErrorState onRetry={() => q.refetch()} />
      </Section>
    );

  return (
    <Section className="max-w-xl">
      <p className="text-caption">Delivery confirmation</p>
      <h1 className="mt-2 text-h3 font-display">{q.data.delivery_number}</h1>
      {TERMINAL.has(q.data.status) ? (
        <AlreadyDone delivery={q.data} />
      ) : (
        <ConfirmForm delivery={q.data} token={token} onDone={() => q.refetch()} />
      )}
    </Section>
  );
}

function AlreadyDone({ delivery }: { delivery: DriverDelivery }) {
  return (
    <div className="mt-6 rounded-md border border-border bg-secondary/40 p-5">
      <p className="text-body">
        This delivery is already marked{" "}
        <strong className="capitalize">{delivery.status.replace(/_/g, " ")}</strong>.
      </p>
      <p className="mt-2 text-body-sm text-muted-foreground">
        Nothing further is needed here.
      </p>
    </div>
  );
}

function ConfirmForm({
  delivery,
  token,
  onDone,
}: {
  delivery: DriverDelivery;
  token: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);
  const [done, setDone] = useState(false);

  const confirm = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("A photo is required");
      const form = new FormData();
      form.append("photo", file);
      if (coords) {
        form.append("reported_lat", String(coords.lat));
        form.append("reported_lng", String(coords.lng));
      }
      if (notes.trim()) form.append("notes", notes.trim());
      await confirmDriverDelivery(token, form);
    },
    onSuccess: () => {
      setDone(true);
      onDone();
    },
  });

  function pickFile(f: File | null) {
    setFile(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setLocateError(true);
      return;
    }
    setLocating(true);
    setLocateError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocateError(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (done) {
    return (
      <div className="mt-6 rounded-md border border-border bg-secondary/40 p-5">
        <p className="text-body font-display text-lg">Delivery confirmed. Thank you!</p>
        <p className="mt-2 text-body-sm text-muted-foreground">
          The customer has been notified. You're all set.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-md border border-border p-4">
        <p className="text-body">
          {delivery.recipient_name_snapshot || "Recipient"}
        </p>
        {delivery.recipient_phone_snapshot && (
          <p className="text-body-sm text-muted-foreground">{delivery.recipient_phone_snapshot}</p>
        )}
        {addressLine(delivery.delivery_address_snapshot) && (
          <p className="mt-1 text-body-sm text-muted-foreground">
            {addressLine(delivery.delivery_address_snapshot)}
          </p>
        )}
        {delivery.delivery_instructions && (
          <p className="mt-2 text-body-sm text-muted-foreground">
            {delivery.delivery_instructions}
          </p>
        )}
      </div>

      <div>
        <p className="text-caption mb-2">Photo of the delivered package (required)</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        {preview ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Delivery proof" className="max-h-64 w-full rounded-md object-cover" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-md border border-dashed border-border py-10 text-body-sm text-muted-foreground hover:bg-secondary/40"
          >
            Tap to take or choose a photo
          </button>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={shareLocation}
          disabled={locating}
          className="rounded-full border border-border px-5 py-2 text-body-sm hover:bg-secondary disabled:opacity-60"
        >
          {locating ? "Getting location…" : coords ? "Location captured ✓" : "Share my location (optional)"}
        </button>
        {locateError && (
          <p className="mt-1 text-body-sm text-muted-foreground">
            Couldn't get your location — you can still confirm without it.
          </p>
        )}
      </div>

      <div>
        <p className="text-caption mb-2">Notes (optional)</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the team should know…"
          className="w-full rounded-md border border-border bg-background p-3 text-body-sm outline-none focus:border-foreground/40"
        />
      </div>

      {confirm.isError && (
        <p className="text-body-sm text-destructive">
          Couldn't confirm this delivery — check the photo and try again.
        </p>
      )}

      <button
        type="button"
        disabled={!file || confirm.isPending}
        onClick={() => confirm.mutate()}
        className="w-full bg-foreground text-background py-4 text-body-sm font-medium disabled:opacity-50"
      >
        {confirm.isPending ? "Confirming…" : "Confirm delivery"}
      </button>
    </div>
  );
}
