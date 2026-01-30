import React, { useEffect, useMemo, useRef, useState } from 'react';

const ITEM_HEIGHT = 44;
const VIEW_HEIGHT = 160;
const COLUMN_WIDTH = 56;
const LOOP_REPEAT = 18;
const WHEEL_COOLDOWN = 100;

const buildRange = (count: number) => Array.from({ length: count }, (_, i) => i);
const DIGITS_0_9 = buildRange(10);
const DIGITS_0_5 = buildRange(6);

type WheelColumnProps = {
  label: string;
  values: number[];
  value: number;
  onChange: (next: number) => void;
};

const WheelColumn: React.FC<WheelColumnProps> = ({ label, values, value, onChange }) => {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const activeIndexRef = useRef<number>(0);
  const lastValueRef = useRef<number>(value);
  const lastWheelRef = useRef<number>(0);
  const padding = (VIEW_HEIGHT - ITEM_HEIGHT) / 2;
  const list = useMemo(() => {
    const total = values.length * LOOP_REPEAT;
    return Array.from({ length: total }, (_, i) => values[i % values.length]);
  }, [values]);
  const baseIndex = values.length * Math.floor(LOOP_REPEAT / 2);
  const [activeIndex, setActiveIndex] = useState(() => {
    const start = values.indexOf(value);
    return baseIndex + (start >= 0 ? start : 0);
  });

  const syncFromScroll = () => {
    const node = columnRef.current;
    if (!node) return;
    const index = Math.round(node.scrollTop / ITEM_HEIGHT);
    const valueIndex = ((index % values.length) + values.length) % values.length;
    const nextValue = values[valueIndex];
    const total = values.length * LOOP_REPEAT;
    const recenterThreshold = values.length * 2;
    if (index < recenterThreshold || index > total - recenterThreshold) {
      const recenteredIndex = baseIndex + valueIndex;
      node.scrollTop = recenteredIndex * ITEM_HEIGHT;
      activeIndexRef.current = recenteredIndex;
      setActiveIndex(recenteredIndex);
    } else {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
    if (nextValue !== lastValueRef.current) {
      lastValueRef.current = nextValue;
      onChange(nextValue);
    }
  };

  const handleScroll = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(syncFromScroll);
  };

  const snapToNearest = () => {
    const node = columnRef.current;
    if (!node) return;
    const index = Math.round(node.scrollTop / ITEM_HEIGHT);
    const targetTop = index * ITEM_HEIGHT;
    smoothScrollTo(node, targetTop);
  };

  const applyStep = (direction: 1 | -1) => {
    const node = columnRef.current;
    if (!node) return;
    const currentValueIndex = values.indexOf(lastValueRef.current);
    const safeIndex = currentValueIndex >= 0 ? currentValueIndex : 0;
    const nextValueIndex = (safeIndex + direction + values.length) % values.length;
    const targetIndex = baseIndex + nextValueIndex;
    const nextValue = values[nextValueIndex];
    activeIndexRef.current = targetIndex;
    setActiveIndex(targetIndex);
    if (nextValue !== lastValueRef.current) {
      lastValueRef.current = nextValue;
      onChange(nextValue);
    }
    const targetTop = targetIndex * ITEM_HEIGHT;
    smoothScrollTo(node, targetTop);
  };

  useEffect(() => {
    const node = columnRef.current;
    if (!node) return;
    const index = values.indexOf(value);
    if (index < 0) return;
    const targetIndex = baseIndex + index;
    lastValueRef.current = value;
    activeIndexRef.current = targetIndex;
    setActiveIndex(targetIndex);
    const targetTop = targetIndex * ITEM_HEIGHT;
    if (Math.abs(node.scrollTop - targetTop) > 1) {
      node.scrollTo({ top: targetTop, behavior: 'auto' });
    }
  }, [value, values, baseIndex]);

  useEffect(() => {
    const node = columnRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - lastWheelRef.current < WHEEL_COOLDOWN) return;
      lastWheelRef.current = now;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      const direction: 1 | -1 = delta > 0 ? 1 : -1;
      applyStep(direction);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', handleWheel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const smoothScrollTo = (node: HTMLDivElement, targetTop: number) => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
    }
    const startTop = node.scrollTop;
    const delta = targetTop - startTop;
    if (Math.abs(delta) < 1) return;
    const duration = 180;
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      node.scrollTop = startTop + delta * easeOutCubic(t);
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      }
    };

    animRef.current = requestAnimationFrame(step);
  };

  return (
    <div
      ref={columnRef}
      className="time-wheel-column snap-y snap-mandatory"
      style={{
        height: VIEW_HEIGHT,
        width: COLUMN_WIDTH,
        paddingTop: padding,
        paddingBottom: padding,
      }}
      onScroll={handleScroll}
      onMouseUp={snapToNearest}
      onTouchEnd={snapToNearest}
      onPointerUp={snapToNearest}
      aria-label={label}
      role="listbox"
    >
      {list.map((val, index) => {
        const isActive = index === activeIndex;
        return (
          <div
            key={`${label}-${index}`}
            className={`time-wheel-item snap-center ${isActive ? 'is-active' : ''}`}
            style={{ height: ITEM_HEIGHT }}
            aria-selected={isActive}
            role="option"
          >
            {val}
          </div>
        );
      })}
    </div>
  );
};

const TimeWheelPicker: React.FC = () => {
  const [hour, setHour] = useState(0);
  const [minuteTens, setMinuteTens] = useState(2);
  const [minuteOnes, setMinuteOnes] = useState(5);
  const [secondTens, setSecondTens] = useState(0);
  const [secondOnes, setSecondOnes] = useState(0);

  return (
    <div className="time-wheel flex items-center justify-center" role="group" aria-label="Time picker">
      <div className="time-wheel-row flex items-center">
        <WheelColumn label="Hours" values={DIGITS_0_5} value={hour} onChange={setHour} />
        <span className="time-wheel-separator">:</span>
        <WheelColumn label="Minutes tens" values={DIGITS_0_5} value={minuteTens} onChange={setMinuteTens} />
        <WheelColumn label="Minutes ones" values={DIGITS_0_9} value={minuteOnes} onChange={setMinuteOnes} />
        <span className="time-wheel-separator">:</span>
        <WheelColumn label="Seconds tens" values={DIGITS_0_5} value={secondTens} onChange={setSecondTens} />
        <WheelColumn label="Seconds ones" values={DIGITS_0_9} value={secondOnes} onChange={setSecondOnes} />
      </div>
    </div>
  );
};

export default TimeWheelPicker;
