import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useMotionPrefs } from "@/hooks/use-motion-prefs";

type Props = {
  children: ReactNode;
  y?: number;
  delay?: number;
  duration?: number;
  index?: number;
  as?: "div" | "article" | "section" | "li" | "span";
  className?: string;
  repeat?: boolean;
};

/**
 * GPU-friendly scroll reveal. Uses only opacity + transform, respects
 * prefers-reduced-motion AND low-end devices (opacity-only fallback).
 */
export function Reveal({
  children,
  y = 24,
  delay,
  duration = 0.8,
  index = 0,
  as = "div",
  className,
  repeat = false,
}: Props) {
  const { motionOk, reduce } = useMotionPrefs();
  const Tag = motion[as];
  const d = delay ?? (index % 6) * 0.08;

  if (reduce) {
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <Tag
      className={className}
      style={{ willChange: "transform, opacity" }}
      initial={{ opacity: 0, y: motionOk ? y : 0 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: !repeat, margin: "-80px" }}
      transition={{ duration: motionOk ? duration : 0.4, delay: d, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}

export function RevealGroup({
  children,
  className,
  stagger = 0.09,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  const { reduce, motionOk } = useMotionPrefs();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: motionOk ? stagger : 0.04, delayChildren: 0.05 } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li" | "section" | "span";
}) {
  const { motionOk, reduce } = useMotionPrefs();
  const Tag = motion[as];
  if (reduce) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      className={className}
      style={{ willChange: "transform, opacity" }}
      variants={
        motionOk
          ? { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } } }
          : { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.45 } } }
      }
    >
      {children}
    </Tag>
  );
}
