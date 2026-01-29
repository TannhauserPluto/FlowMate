import React, { forwardRef, useRef } from 'react';

type VoiceInputProps = {
  placeholder: string;
  plusIcon: string;
  audioIcon: string;
  onActivate?: () => void;
  onFocusCapture?: () => void;
};

const VoiceInput = forwardRef<HTMLInputElement, VoiceInputProps>(
  ({ placeholder, plusIcon, audioIcon, onActivate, onFocusCapture }, ref) => {
    const localRef = useRef<HTMLInputElement | null>(null);
    const inputRef = (ref as React.MutableRefObject<HTMLInputElement | null>) ?? localRef;

    const handleMouseDown = () => {
      if (onActivate) onActivate();
      inputRef.current?.focus();
    };

    return (
      <div
        className="voice-input glass-widget glass-widget--border glass-widget-surface"
        onMouseDown={handleMouseDown}
      >
        <button className="voice-plus" type="button" aria-label="Add">
          <img src={plusIcon} alt="" />
        </button>
        <input
          ref={inputRef}
          className="voice-text-input"
          type="text"
          placeholder={placeholder}
          onFocus={onFocusCapture}
        />
        <button className="voice-action" type="button" aria-label="Speak">
          <span className="voice-action-bg" aria-hidden="true" />
          <img src={audioIcon} alt="" />
        </button>
      </div>
    );
  },
);

VoiceInput.displayName = 'VoiceInput';

export default VoiceInput;
