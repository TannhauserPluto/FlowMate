import React from 'react';

type ActionFloatingBtnProps = {
  currentView: 'home' | 'task';
  onGoToTimerConfig: () => void;
  onStartWork: () => void;
};

const ActionFloatingBtn: React.FC<ActionFloatingBtnProps> = ({
  currentView,
  onGoToTimerConfig,
  onStartWork,
}) => {
  const isHome = currentView === 'home';
  const label = isHome ? '番茄钟' : '开始工作';
  const handleClick = isHome ? onGoToTimerConfig : onStartWork;

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
