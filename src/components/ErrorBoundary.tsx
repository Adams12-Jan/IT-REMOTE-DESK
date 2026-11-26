import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button, Card } from './ui/primitives';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Vetiva ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendly = String(parsed.error);
        }
      } catch {
        // Plain error message
      }

      return (
        <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center p-6">
          <Card className="max-w-lg w-full p-6 text-center space-y-4">
            <ShieldAlert className="h-10 w-10 text-[#D32027] mx-auto" />
            <h1 className="font-display text-lg font-bold text-neutral-900">
              Vetiva Virtual Remote Desk Encountered an Error
            </h1>
            <p className="text-xs text-neutral-600 break-words leading-relaxed">
              {friendly}
            </p>
            <Button
              type="button"
              variant="primary"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </Button>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
