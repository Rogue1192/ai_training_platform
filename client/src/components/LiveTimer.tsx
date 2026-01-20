import { useState, useEffect } from "react";

interface LiveTimerProps {
  startDate: Date | string;
  className?: string;
}

/**
 * LiveTimer component that displays elapsed time and updates every second.
 * Shows format: "Xd Xh Xm Xs" with live ticking seconds.
 */
export function LiveTimer({ startDate, className }: LiveTimerProps) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const calculateElapsed = () => {
      const start = new Date(startDate);
      const now = new Date();
      const diffMs = now.getTime() - start.getTime();
      
      // Handle negative values (shouldn't happen but just in case)
      if (diffMs < 0) {
        return "0s";
      }

      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      const seconds = diffSecs % 60;
      const minutes = diffMins % 60;
      const hours = diffHours % 24;

      // Build the display string
      const parts: string[] = [];
      
      if (diffDays > 0) {
        parts.push(`${diffDays}d`);
      }
      if (diffHours > 0 || diffDays > 0) {
        parts.push(`${hours}h`);
      }
      if (diffMins > 0 || diffHours > 0 || diffDays > 0) {
        parts.push(`${minutes}m`);
      }
      parts.push(`${seconds}s`);

      return parts.join(" ");
    };

    // Initial calculation
    setElapsed(calculateElapsed());

    // Update every second
    const interval = setInterval(() => {
      setElapsed(calculateElapsed());
    }, 1000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, [startDate]);

  return <span className={className}>{elapsed}</span>;
}

export default LiveTimer;
