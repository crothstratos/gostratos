import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    const message = error.message || '';
    if (message.includes('Failed to fetch dynamically imported module') || message.includes('Importing a module script failed')) {
      window.location.reload();
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  public componentDidMount() {
    window.addEventListener('unhandledrejection', this.handlePromiseRejection);
  }

  public componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handlePromiseRejection);
  }

  private shouldIgnoreError(error: Error | string): boolean {
    const message = typeof error === 'string' ? error : error?.message || '';
    if (!message) return false;
    
    // Ignore transient network and Firebase connection errors
    const ignoredMessages = [
      'WebSocket closed without opened',
      'Could not reach Cloud Firestore backend',
      'The client is offline',
      'NetworkError',
      'Load failed'
    ];
    
    return ignoredMessages.some(msg => message.includes(msg));
  }

  private handleError = (event: ErrorEvent) => {
    const message = event.error?.message || event.message || '';
    if (message.includes('Failed to fetch dynamically imported module') || message.includes('Importing a module script failed')) {
      window.location.reload();
      return;
    }
    if (this.shouldIgnoreError(event.error || event.message)) {
      console.warn('Ignored transient error:', event.error || event.message);
      return;
    }
    this.setState({ hasError: true, error: event.error || new Error(event.message) });
  };

  private handlePromiseRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    if (this.shouldIgnoreError(error)) {
      console.warn('Ignored transient promise rejection:', error);
      return;
    }
    this.setState({ hasError: true, error });
  };

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = this.state.error?.message || 'An unexpected error occurred.';
      let isFirestoreError = false;
      let firestoreDetails = null;

      try {
        if (errorMessage.startsWith('{')) {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error && parsed.operationType) {
            isFirestoreError = true;
            firestoreDetails = parsed;
            errorMessage = parsed.error;
          }
        }
      } catch (e) {
        // Not a JSON string
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
          <div className="max-w-xl w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-red-200 dark:border-red-900/50 p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Something went wrong</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">The application encountered an error.</p>
              </div>
            </div>

            <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-4 mb-6 border border-red-100 dark:border-red-900/30">
              <p className="text-sm font-medium text-red-800 dark:text-red-300 break-words">
                {errorMessage}
              </p>
              {isFirestoreError && firestoreDetails && (
                <div className="mt-4 text-xs text-red-700 dark:text-red-400 space-y-1">
                  <p><strong>Operation:</strong> {firestoreDetails.operationType}</p>
                  <p><strong>Path:</strong> {firestoreDetails.path || 'N/A'}</p>
                  {errorMessage.includes('Missing or insufficient permissions') && (
                    <p className="mt-2 text-red-600 dark:text-red-300 font-medium">
                      This is a security rules error. Please ensure your Firestore rules allow this operation.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
              >
                Reload Page
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
