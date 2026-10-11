import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What was being shown, for the message. */
  label: string;
}

/** Keeps one failing panel from blanking the page around it. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p role="alert" className="text-danger text-sm">
          {this.props.label} could not be shown. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}
