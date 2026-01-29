import React, { useEffect, useRef } from 'react';

type Bounds = { x: number; y: number; width: number; height: number };

type ResizeState = {
  handle: string;
  startX: number;
  startY: number;
  startBounds: Bounds;
};

type UiScaleFrameProps = {
  children: React.ReactNode;
};

const DESIGN_WIDTH = 985.766;
const DESIGN_HEIGHT = 554.493;
const ASPECT_RATIO = DESIGN_WIDTH / DESIGN_HEIGHT;
const MIN_WIDTH = 380;
const MAX_WIDTH = 1600;
const MIN_HEIGHT = Math.round(MIN_WIDTH / ASPECT_RATIO);
const MAX_HEIGHT = Math.round(MAX_WIDTH / ASPECT_RATIO);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function computeBounds(state: ResizeState, dx: number, dy: number): Bounds {
  const start = state.startBounds;
  let width = start.width;
  let height = start.height;
  let x = start.x;
  let y = start.y;

  const handle = state.handle;
  const fromLeft = handle.includes('left');
  const fromRight = handle.includes('right');
  const fromTop = handle.includes('top');
  const fromBottom = handle.includes('bottom');

  if (handle === 'left' || handle === 'right') {
    const delta = fromLeft ? -dx : dx;
    width = clamp(start.width + delta, MIN_WIDTH, MAX_WIDTH);
    height = Math.round(width / ASPECT_RATIO);
    if (fromLeft) x = start.x + (start.width - width);
    return { x, y, width, height };
  }

  if (handle === 'top' || handle === 'bottom') {
    const delta = fromTop ? -dy : dy;
    height = clamp(start.height + delta, MIN_HEIGHT, MAX_HEIGHT);
    width = Math.round(height * ASPECT_RATIO);
    if (fromTop) y = start.y + (start.height - height);
    return { x, y, width, height };
  }

  const useDx = Math.abs(dx) >= Math.abs(dy) * ASPECT_RATIO;

  if (useDx) {
    const delta = fromLeft ? -dx : dx;
    width = clamp(start.width + delta, MIN_WIDTH, MAX_WIDTH);
    height = Math.round(width / ASPECT_RATIO);
  } else {
    const delta = fromTop ? -dy : dy;
    height = clamp(start.height + delta, MIN_HEIGHT, MAX_HEIGHT);
    width = Math.round(height * ASPECT_RATIO);
  }

  if (fromLeft) x = start.x + (start.width - width);
  if (fromTop) y = start.y + (start.height - height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

const UiScaleFrame: React.FC<UiScaleFrameProps> = ({ children }) => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!frameRef.current) return;

    const updateScale = () => {
      if (!frameRef.current) return;
      const { width, height } = frameRef.current.getBoundingClientRect();
      const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
      frameRef.current.style.setProperty('--ui-scale', String(scale));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frameRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handles = document.querySelectorAll('[data-resize-handle]');

    const onPointerMove = (event: PointerEvent) => {
      if (!resizeState.current) return;
      const { startX, startY } = resizeState.current;
      const dx = event.screenX - startX;
      const dy = event.screenY - startY;
      const nextBounds = computeBounds(resizeState.current, dx, dy);

      if (rafId.current !== null) return;
      rafId.current = window.requestAnimationFrame(() => {
        rafId.current = null;
        if (
          Number.isFinite(nextBounds.x) &&
          Number.isFinite(nextBounds.y) &&
          Number.isFinite(nextBounds.width) &&
          Number.isFinite(nextBounds.height)
        ) {
          (window as any).electron
            ?.invoke('window:set-bounds', nextBounds)
            .catch(() => {});
        }
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      target?.releasePointerCapture?.(event.pointerId);
      resizeState.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    const onPointerDown = async (event: Event) => {
      const pointerEvent = event as PointerEvent;
      const target = pointerEvent.currentTarget as HTMLElement | null;
      if (!target) return;
      const handle = target.dataset.resizeHandle || '';
      const bounds = await (window as any).electron?.invoke('window:get-bounds');
      if (!bounds) return;

      resizeState.current = {
        handle,
        startX: pointerEvent.screenX,
        startY: pointerEvent.screenY,
        startBounds: {
          x: Math.round(Number(bounds.x)),
          y: Math.round(Number(bounds.y)),
          width: Math.round(Number(bounds.width)),
          height: Math.round(Number(bounds.height)),
        },
      };

      target.setPointerCapture(pointerEvent.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      pointerEvent.preventDefault();
    };

    handles.forEach((handle) => {
      handle.addEventListener('pointerdown', onPointerDown);
    });

    return () => {
      handles.forEach((handle) => {
        handle.removeEventListener('pointerdown', onPointerDown);
      });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  return (
    <div ref={frameRef} className="app-frame" data-name="Base" data-node-id="240:214">
      <div className="glass-border" aria-hidden="true">
        <span className="border-edge border-top" />
        <span className="border-edge border-right" />
        <span className="border-edge border-bottom" />
        <span className="border-edge border-left" />
        <span className="border-corner border-corner-top-left" />
      </div>
      <div className="app-container">
        <div className="ui-scale">{children}</div>
      </div>
      <div className="resize-overlay">
        <div className="resize-handle handle-top" data-resize-handle="top" />
        <div className="resize-handle handle-right" data-resize-handle="right" />
        <div className="resize-handle handle-bottom" data-resize-handle="bottom" />
        <div className="resize-handle handle-left" data-resize-handle="left" />
        <div className="resize-handle handle-top-left" data-resize-handle="top-left" />
        <div className="resize-handle handle-top-right" data-resize-handle="top-right" />
        <div className="resize-handle handle-bottom-left" data-resize-handle="bottom-left" />
        <div className="resize-handle handle-bottom-right" data-resize-handle="bottom-right" />
      </div>
    </div>
  );
};

export default UiScaleFrame;
