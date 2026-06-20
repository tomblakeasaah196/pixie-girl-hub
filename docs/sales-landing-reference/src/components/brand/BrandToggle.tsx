import { useBrand } from "./BrandProvider";
import { BRANDS } from "@/lib/brands";

export function BrandToggle() {
  const { brandId, setBrandId } = useBrand();
  return (
    <div className="fixed top-4 right-4 z-[200] flex items-center gap-1 rounded-full border border-white/15 bg-black/40 p-1 backdrop-blur-md">
      {(Object.keys(BRANDS) as Array<keyof typeof BRANDS>).map((id) => (
        <button
          key={id}
          onClick={() => setBrandId(id)}
          className={`px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase rounded-full transition-colors ${
            brandId === id ? "bg-white text-black" : "text-white/70 hover:text-white"
          }`}
        >
          {BRANDS[id].wordmark.split(" ")[0]}
        </button>
      ))}
    </div>
  );
}
