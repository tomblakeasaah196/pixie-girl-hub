export default function Loading() {
  return (
    <main
      className="min-h-screen grid place-items-center"
      style={{ background: "rgb(var(--brand-ink, 16 9 5))" }}
    >
      <div className="text-[11px] tracking-[0.4em] uppercase text-white/40 animate-pulse">
        Closing the door…
      </div>
    </main>
  );
}
