import {
  Phone,
  MessageCircle,
  Mail,
  Users,
  FileText,
  DollarSign,
  CheckSquare,
  AlertCircle,
  Activity,
  Calendar,
  MapPin,
  Instagram,
} from "lucide-react";
import type { ActivityType } from "@/pages/contacts/types";

const ACTIVITY_META: Record<
  ActivityType,
  { icon: typeof Phone; color: string; label: string }
> = {
  call: { icon: Phone, color: "#5aa0a8", label: "Call" },
  sms: { icon: MessageCircle, color: "#8b9d77", label: "SMS" },
  whatsapp_msg: { icon: MessageCircle, color: "#25D366", label: "WhatsApp" },
  instagram_dm: { icon: Instagram, color: "#E1306C", label: "Instagram DM" },
  email: { icon: Mail, color: "#7a8fa8", label: "Email" },
  meeting: { icon: Users, color: "#9c7ad9", label: "Meeting" },
  website_chat: { icon: Activity, color: "#5aa0a8", label: "Chat" },
  walk_in_visit: { icon: MapPin, color: "#d4a853", label: "Walk-in" },
  quote_sent: { icon: FileText, color: "#b76e79", label: "Quote Sent" },
  payment_received: { icon: DollarSign, color: "#8b9d77", label: "Payment" },
  system_note: { icon: AlertCircle, color: "#7a8fa8", label: "System Note" },
  status_change: {
    icon: CheckSquare,
    color: "#9c7ad9",
    label: "Status Change",
  },
  follow_up_scheduled: { icon: Calendar, color: "#d4a853", label: "Follow-up" },
  task_created: { icon: CheckSquare, color: "#5aa0a8", label: "Task" },
};

interface ActivityIconProps {
  type: ActivityType;
  size?: "sm" | "md";
}

export function ActivityIcon({ type, size = "md" }: ActivityIconProps) {
  const meta = ACTIVITY_META[type] ?? {
    icon: Activity,
    color: "#7a8fa8",
    label: type,
  };
  const Icon = meta.icon;
  const dim = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  const wrap = size === "sm" ? "w-6 h-6" : "w-8 h-8";

  return (
    <div
      className={`${wrap} rounded-full grid place-items-center flex-shrink-0`}
      style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
    >
      <Icon className={dim} />
    </div>
  );
}

export function activityLabel(type: ActivityType): string {
  return ACTIVITY_META[type]?.label ?? type;
}

export function activityColor(type: ActivityType): string {
  return ACTIVITY_META[type]?.color ?? "#7a8fa8";
}
