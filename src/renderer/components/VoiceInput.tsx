import React, { forwardRef, useRef } from 'react';

type VoiceInputProps = {
  placeholder: string;
  plusIcon: string;
  audioIcon: string;
  isRecording?: boolean;
  onActivate?: () => void;
  onFocusCapture?: () => void;
  onSubmit?: (value: string) => void;
  onAudioClick?: () => void;
};

const VoiceInput = forwardRef<HTMLInputElement, VoiceInputProps>(
  ({ placeholder, plusIcon, audioIcon, isRecording = false, onActivate, onFocusCapture, onSubmit, onAudioClick }, ref) => {
    const localRef = useRef<HTMLInputElement | null>(null);
    const inputRef = (ref as React.MutableRefObject<HTMLInputElement | null>) ?? localRef;

    const handleMouseDown = () => {
      if (onActivate) onActivate();
      inputRef.current?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter' || !onSubmit) return;
      const value = inputRef.current?.value?.trim() ?? '';
      if (!value) return;
      event.preventDefault();
      onSubmit(value);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    };

    const handleAudioClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!onAudioClick) return;
      event.preventDefault();
      event.stopPropagation();
      onAudioClick();
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
          onKeyDown={handleKeyDown}
        />
        <button
          className={`voice-action ${isRecording ? 'is-recording' : ''}`}
          type="button"
          aria-label="Speak"
          onClick={handleAudioClick}
        >
          <span className="voice-action-bg" aria-hidden="true" />
          <img src={audioIcon} alt="" />
        </button>
      </div>
    );
  },
);

VoiceInput.displayName = 'VoiceInput';

export default VoiceInput;
