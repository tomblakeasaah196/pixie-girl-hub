"use client";

import { useEffect, useState } from "react";

export function ScrollIndicator() {
  const [atBottom, setAtBottom] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => {
      const pageIsScrollable = document.body.scrollHeight > window.innerHeight + 10;
      const nearBottom =
        window.scrollY + window.innerHeight >= document.body.scrollHeight - 60;

      setVisible(pageIsScrollable);
      setAtBottom(nearBottom);
    };

    // Run immediately + on every scroll + on resize (orientation change etc.)
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });

    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  const handleClick = () => {
    if (atBottom) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  };

  return (
    <button
      onClick={handleClick}
      aria-label={atBottom ? "Scroll to top" : "Scroll down"}
      style={{ color: "rgb(var(--accent-glow))" }}
      className={[
        "fixed z-50 right-5 bottom-5",
        "flex items-center justify-center",
        "w-10 h-10 rounded-full bg-transparent border-0",
        "transition-all duration-300 ease-out",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
        "hover:scale-110",
      ].join(" ")}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="transition-transform duration-300"
        style={{ transform: atBottom ? "rotate(180deg)" : "rotate(0deg)" }}
      >
        <polyline points="6 5 12 11 18 5" strokeOpacity="0.45" />
        <polyline points="6 13 12 19 18 13" />
      </svg>
    </button>
  );
}