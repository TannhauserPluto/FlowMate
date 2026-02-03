import React from 'react';

type ActionFloatingBtnProps = {
  currentView: 'home' | 'task' | 'timer' | 'focus' | 'break';
  onGoToTimerConfig: () => void;
  onStartWork: () => void;
  onPause: () => void;
  onEnd: () => void;
  onBreakEnd: () => void;
  isFocusRunning: boolean;
};

const ActionFloatingBtn: React.FC<ActionFloatingBtnProps> = ({
  currentView,
  onGoToTimerConfig,
  onStartWork,
  onPause,
  onEnd,
  onBreakEnd,
  isFocusRunning,
}) => {
  const isHome = currentView === 'home';
  const isFocus = currentView === 'focus';
  const label = isHome ? '\u756a\u8304\u949f' : '\u5f00\u59cb\u5de5\u4f5c';
  const handleClick = isHome ? onGoToTimerConfig : onStartWork;

  if (currentView === 'break') {
    return (
      <button
        type="button"
        className="action-fab glass-widget glass-widget--border glass-widget-surface"
        onClick={onBreakEnd}
        aria-label="\u7ed3\u675f"
      >
        <span className="action-fab__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation">
            <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor" />
          </svg>
        </span>
        <span className="action-fab__label">{'\u7ed3\u675f'}</span>
      </button>
    );
  }

  if (isFocus) {
    const pauseLabel = isFocusRunning ? '\u6682\u505c' : '\u7ee7\u7eed';
    return (
      <div className="action-fab-group" role="group" aria-label="Focus controls">
        <button
          type="button"
          className="action-fab glass-widget glass-widget--border glass-widget-surface"
          onClick={onPause}
          aria-label={pauseLabel}
        >
          <span className="action-fab__icon" aria-hidden="true">
            {isFocusRunning ? (
              <svg viewBox="0 0 24 24" role="presentation">
                <rect x="6.5" y="5.5" width="4" height="13" rx="1.2" fill="currentColor" />
                <rect x="13.5" y="5.5" width="4" height="13" rx="1.2" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" role="presentation">
                <path d="M7.5 5.5l11 6.5-11 6.5V5.5z" fill="currentColor" />
              </svg>
            )}
          </span>
          <span className="action-fab__label">{pauseLabel}</span>
        </button>
        <button
          type="button"
          className="action-fab glass-widget glass-widget--border glass-widget-surface"
          onClick={onEnd}
          aria-label="\u7ed3\u675f"
        >
          <span className="action-fab__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation">
              <path
                d="M12 4.5l2.35 4.76 5.26.77-3.8 3.7.9 5.24L12 16.8l-4.71 2.47.9-5.24-3.8-3.7 5.26-.77L12 4.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="action-fab__label">{'\u7ed3\u675f'}</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="action-fab glass-widget glass-widget--border glass-widget-surface"
      onClick={handleClick}
      aria-label={label}
    >
      <span className="action-fab__icon" aria-hidden="true">
        {isHome ? (
          <svg viewBox="0 0 24 24" role="presentation">
            <path
              d="M12 4a8 8 0 1 1-6.93 12.02"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M8.2 3.8 6.1 1.8M15.8 3.8l2.1-2M12 7v5l3 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" role="presentation">
            <path
              d="M6 3h8l4 4v14H6z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 3v5h5M8.5 12h7M8.5 16h7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span className="action-fab__label">{label}</span>
    </button>
  );
};

export default ActionFloatingBtn;
