import { Component, type ErrorInfo, type ReactNode } from 'react';

// React 트리 어느 부분에서든 렌더링 에러가 나면 페이지 전체가 백지가 되지 않도록 잡아낸다.
// 사용자에게는 친절한 메시지를, 콘솔에는 스택과 함께 로그.

interface Props {
  children: ReactNode;
  // 에러 발생 시 표시할 fallback 제목 (선택)
  title?: string;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] React 렌더링 에러', error, errorInfo);
    this.setState({ errorInfo });
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const isMinified = /Minified React error/.test(this.state.error.message);
    return (
      <div className="min-h-[300px] flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-white border border-red-200 rounded-lg shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">⚠️</span>
            <h2 className="text-lg font-bold text-gray-900">
              {this.props.title || '화면을 표시하는 중 오류가 발생했습니다'}
            </h2>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            이 화면의 일부 데이터를 렌더링하지 못했습니다. 새로고침하거나 잠시 후 다시 시도해주세요.
            문제가 반복되면 관리자에게 아래 오류 정보를 전달해주세요.
          </p>
          <details className="text-xs bg-gray-50 border rounded p-2 mb-3">
            <summary className="cursor-pointer font-semibold text-gray-700">오류 상세</summary>
            <div className="mt-2 space-y-1 break-all font-mono">
              <div className="text-red-700">{this.state.error.message}</div>
              {isMinified && (
                <div className="text-gray-500">
                  (Minified React 에러 — 개발 환경에서는 원문 메시지 확인 가능)
                </div>
              )}
              {this.state.errorInfo?.componentStack && (
                <pre className="text-gray-500 whitespace-pre-wrap text-[10px] mt-2">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>
          </details>
          <div className="flex gap-2">
            <button onClick={this.reset} className="btn-secondary text-xs">
              다시 시도
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary text-xs"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}
