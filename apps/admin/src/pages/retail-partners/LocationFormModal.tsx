import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { useRpMutations } from "./hooks";
import { FieldLabel, TextInput, InfoBanner } from "./parts";
import type { RetailPartner } from "./types";

/**
 * Add a consignment location. The backend needs a stock_location of type
 * partner_consignment to exist first, so this chains the two creates
 * (stock location → consignment location) behind one form. If the second
 * call fails, the created stock location is kept and retry only re-links.
 */
export function LocationFormModal({
  open,
  onClose,
  partner,
}: {
  open: boolean;
  onClose: () => void;
  partner: RetailPartner;
}) {
  const { createStockLocation, createLocation } = useRpMutations();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [managerName, setManagerName] = useState("");
  const [managerPhone, setManagerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Survives a failed link so retry doesn't create a duplicate stock location.
  const [stockLocationId, setStockLocationId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAddress("");
    setCity("");
    setState("");
    setManagerName("");
    setManagerPhone("");
    setError(null);
    setStockLocationId(null);
  }, [open]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      let slId = stockLocationId;
      if (!slId) {
        const code = `CON-${partner.partner_code}-${Date.now()
          .toString(36)
          .slice(-4)
          .toUpperCase()}`;
        const sl = await createStockLocation.mutateAsync({
          location_code: code,
          display_name: `${partner.display_name} — ${name.trim()}`,
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state.trim() ? { state: state.trim() } : {}),
        });
        slId = sl.location_id;
        setStockLocationId(slId);
      }
      await createLocation.mutateAsync({
        partnerId: partner.partner_id,
        input: {
          stock_location_id: slId,
          display_name: name.trim(),
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state.trim() ? { state: state.trim() } : {}),
          ...(managerName.trim() ? { manager_name: managerName.trim() } : {}),
          ...(managerPhone.trim() ? { manager_phone: managerPhone.trim() } : {}),
        },
      });
      onClose();
    } catch (err) {
      setError(
        (err as Error)?.message ||
          "Could not save the location — try again to finish linking.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add location — ${partner.display_name}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!name.trim() || busy}
          >
            {busy ? "Saving…" : "Add location"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Location name *</FieldLabel>
          <TextInput
            value={name}
            onChange={setName}
            placeholder="e.g. Lekki boutique"
          />
        </div>
        <div>
          <FieldLabel>Address</FieldLabel>
          <TextInput
            value={address}
            onChange={setAddress}
            placeholder="Street address"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>City</FieldLabel>
            <TextInput value={city} onChange={setCity} placeholder="Lagos" />
          </div>
          <div>
            <FieldLabel>State</FieldLabel>
            <TextInput value={state} onChange={setState} placeholder="Lagos" />
          </div>
          <div>
            <FieldLabel>Manager</FieldLabel>
            <TextInput
              value={managerName}
              onChange={setManagerName}
              placeholder="Who runs this location"
            />
          </div>
          <div>
            <FieldLabel>Manager phone</FieldLabel>
            <TextInput
              value={managerPhone}
              onChange={setManagerPhone}
              placeholder="+234…"
            />
          </div>
        </div>
        <InfoBanner>
          A matching stock location (type partner consignment) is created in
          Stock automatically, so consignment counts show up in the one true
          count.
        </InfoBanner>
        {error && <InfoBanner tone="warn">{error}</InfoBanner>}
      </div>
    </Modal>
  );
}
