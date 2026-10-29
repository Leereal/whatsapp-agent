import { useEffect, useRef } from "react";

/** Run `task` now and then every `intervalMs` while enabled */
export function usePolling(task: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    const run = () => void latest.current();
    const first = setTimeout(run, 0);
    const timer = setInterval(run, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}
