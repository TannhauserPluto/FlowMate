import React, { useRef, useEffect, useState } from 'react';

// 视频资源映射 (MVP: 需要用户提供这些视频文件)
const VIDEO_SOURCES: Record<string, string> = {
  idle: '/assets/video_loops/idle.webm',
  work: '/assets/video_loops/work.webm',
  focus: '/assets/video_loops/focus.webm',
  shhh: '/assets/video_loops/shhh.webm',
  stretch: '/assets/video_loops/stretch.webm',
};

// 状态对应的显示文字和图标
const STATE_INFO: Record<string, { label: string; emoji: string; description: string }> = {
  idle: { label: '待机', emoji: '📖', description: '安静看书中...' },
  work: { label: '陪伴中', emoji: '⌨️', description: '一起打字ing' },
  focus: { label: '关注', emoji: '👀', description: '在看着你哦' },
  shhh: { label: '嘘~', emoji: '🤫', description: '心流保护中' },
  stretch: { label: '休息', emoji: '🧘', description: '起来活动一下' },
};

interface VideoAvatarProps {
  state: 'idle' | 'work' | 'focus' | 'shhh' | 'stretch';
}

/**
 * 视频数字人组件 (MVP 版本)
 * 支持视频播放和占位符显示
 */
const VideoAvatar: React.FC<VideoAvatarProps> = ({ state }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentSrc, setCurrentSrc] = useState(VIDEO_SOURCES.idle);
  const [videoError, setVideoError] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // 状态变化时切换视频
  useEffect(() => {
    const newSrc = VIDEO_SOURCES[state];
    if (newSrc !== currentSrc) {
      handleVideoTransition(newSrc);
    }
  }, [state, currentSrc]);

  // 处理视频切换
  const handleVideoTransition = async (newSrc: string) => {
    setIsTransitioning(true);

    if (videoRef.current) {
      videoRef.current.style.opacity = '0';
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    setCurrentSrc(newSrc);
    setVideoError(false);

    if (videoRef.current) {
      videoRef.current.style.opacity = '1';
    }

    setIsTransitioning(false);
  };

  // 视频加载完成后自动播放
  const handleLoadedData = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => setVideoError(true));
    }
  };

  // 视频加载失败
  const handleError = () => {
    setVideoError(true);
  };

  const stateInfo = STATE_INFO[state];

  return (
    <div className="video-avatar-container">
      {/* 视频播放器 */}
      {!videoError && (
        <video
          ref={videoRef}
          className="video-avatar"
          src={currentSrc}
          loop
          muted
          playsInline
          onLoadedData={handleLoadedData}
          onError={handleError}
          style={{
            transition: 'opacity 0.15s ease-in-out',
            opacity: isTransitioning ? 0 : 1,
          }}
        />
      )}

      {/* 占位符 (视频不可用时显示) */}
      {videoError && (
        <div className={`avatar-placeholder ${state}`}>
          <div className="placeholder-emoji">{stateInfo.emoji}</div>
          <div className="placeholder-description">{stateInfo.description}</div>
        </div>
      )}

      {/* 状态标签 */}
      <div className={`avatar-state-label ${state}`}>
        <span className="state-emoji">{stateInfo.emoji}</span>
        <span className="state-text">{stateInfo.label}</span>
      </div>

      {/* 嘘动画特效 */}
      {state === 'shhh' && (
        <div className="shhh-effect">
          <div className="shhh-wave"></div>
          <div className="shhh-wave delay-1"></div>
          <div className="shhh-wave delay-2"></div>
        </div>
      )}
    </div>
  );
};

export default VideoAvatar;
