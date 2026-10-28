import { Component, type ReactNode } from "react";
import { reportError } from "../sentry";

/** Reports a crashed panel to Sentry and offers a reload instead of a blank page */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    reportError(error, { area: "ui" });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="p-4 text-sm">
        <p className="font-medium">Something went wrong.</p>
        <button className="mt-2 underline" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
