import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TimeAgoProps {
  date: string;
  className?: string;
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [relative, setRelative] = useState(() => formatRelative(date));

  useEffect(() => {
    setRelative(formatRelative(date));
    const interval = setInterval(() => {
      setRelative(formatRelative(date));
    }, 60_000);
    return () => clearInterval(interval);
  }, [date]);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={date} className={className}>
            {relative}
          </time>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{formatAbsolute(date)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
