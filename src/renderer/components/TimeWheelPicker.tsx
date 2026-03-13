import React, { useEffect, useMemo, useRef, useState } from 'react';
import imgDigit0 from '../assets/digits/0.png';
import imgDigit1 from '../assets/digits/1.png';
import imgDigit2 from '../assets/digits/2.png';
import imgDigit3 from '../assets/digits/3.png';
import imgDigit4 from '../assets/digits/4.png';
import imgDigit5 from '../assets/digits/5.png';
import imgDigit6 from '../assets/digits/6.png';
import imgDigit7 from '../assets/digits/7.png';
import imgDigit8 from '../assets/digits/8.png';
import imgDigit9 from '../assets/digits/9.png';
import imgColon from '../assets/digits/colon.png';

const DEFAULT_ITEM_HEIGHT = 32;
const DEFAULT_VIEW_HEIGHT = 160;
const DEFAULT_COLUMN_WIDTH = 56;
const DEFAULT_SEPARATOR_HEIGHT = 48;
const LOOP_REPEAT = 18;
const WHEEL_COOLDOWN = 100;

const buildRange = (count: number) => Array.from({ length: count }, (_, i) => i);
const DIGITS_0_9 = buildRange(10);
const DIGITS_0_5 = buildRange(6);
const DIGIT_IMAGES = [
  imgDigit0,
  imgDigit1,
  imgDigit2,
  imgDigit3,
  imgDigit4,
  imgDigit5,
  imgDigit6,
  imgDigit7,
  imgDigit8,
  imgDigit9,
];

export type TimeWheelValue = {
  hour: number;
  minuteTens: number;
  minuteOnes: number;
  secondTens: number;
  secondOnes: number;
};

type TimeWheelSize = {
  itemHeight?: number;
  viewHeight?: number;
  columnWidth?: number;
  separatorHeight?: number;
};

type WheelColumnProps = {
  label: string;
  values: number[];
  value: number;
  itemHeight: number;
  viewHeight: number;
  columnWidth: number;
  interactive: boolean;
  animate: boolean;
  onChange?: (next: number) => void;
};

const WheelColumn: React.FC<WheelColumnProps> = ({
  label,
  values,
  value,
  itemHeight,
  viewHeight,
  columnWidth,
  interactive,
  animate,
  onChange,
}) => {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const activeIndexRef = useRef<number>(0);
  const lastValueRef = useRef<number>(value);
  const lastWheelRef = useRef<number>(0);
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
    const index = Math.round(node.scrollTop / itemHeight);
    const valueIndex = ((index % values.length) + values.length) % values.length;
    const nextValue = values[valueIndex];
    const total = values.length * LOOP_REPEAT;
    const recenterThreshold = values.length * 2;
    if (index < recenterThreshold || index > total - recenterThreshold) {
      const recenteredIndex = baseIndex + valueIndex;
      node.scrollTop = recenteredIndex * itemHeight;
      activeIndexRef.current = recenteredIndex;
      setActiveIndex(recenteredIndex);
    } else {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
    if (onChange && nextValue !== lastValueRef.current) {
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
    const index = Math.round(node.scrollTop / itemHeight);
    const targetTop = index * itemHeight;
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
    if (onChange && nextValue !== lastValueRef.current) {
      lastValueRef.current = nextValue;
      onChange(nextValue);
    }
    const targetTop = targetIndex * itemHeight;
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
    const targetTop = targetIndex * itemHeight;
    if (Math.abs(node.scrollTop - targetTop) > 1) {
      if (animate) {
        smoothScrollTo(node, targetTop);
      } else {
        node.scrollTo({ top: targetTop, behavior: 'auto' });
      }
    }
  }, [value, values, baseIndex, itemHeight, animate]);

  useEffect(() => {
    const node = columnRef.current;
    if (!node || !interactive) return;
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
  }, [interactive, applyStep]);

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
        height: viewHeight,
        width: columnWidth,
      }}
      onScroll={interactive ? handleScroll : undefined}
      onMouseUp={interactive ? snapToNearest : undefined}
      onTouchEnd={interactive ? snapToNearest : undefined}
      onPointerUp={interactive ? snapToNearest : undefined}
      aria-label={label}
      role="listbox"
    >
      {list.map((val, index) => {
        const isActive = index === activeIndex;
        return (
          <div
            key={`${label}-${index}`}
            className={`time-wheel-item snap-center ${isActive ? 'is-active' : ''}`}
            aria-selected={isActive}
            role="option"
          >
            <img className="time-wheel-digit" src={DIGIT_IMAGES[val]} alt={`${val}`} />
          </div>
        );
      })}
    </div>
  );
};

type TimeWheelPickerProps = {
  value?: TimeWheelValue;
  onChange?: (next: TimeWheelValue) => void;
  interactive?: boolean;
  animate?: boolean;
  size?: TimeWheelSize;
  className?: string;
};

const TimeWheelPicker: React.FC<TimeWheelPickerProps> = ({
  value,
  onChange,
  interactive = true,
  animate = false,
  size,
  className,
}) => {
  const [internalValue, setInternalValue] = useState<TimeWheelValue>(
    value ?? { hour: 0, minuteTens: 2, minuteOnes: 5, secondTens: 0, secondOnes: 0 },
  );
  const currentValue = value ?? internalValue;
  const viewHeight = size?.viewHeight ?? DEFAULT_VIEW_HEIGHT;
  const itemHeight = size?.itemHeight ?? DEFAULT_ITEM_HEIGHT;
  const columnWidth = size?.columnWidth ?? DEFAULT_COLUMN_WIDTH;
  const separatorHeight = size?.separatorHeight ?? DEFAULT_SEPARATOR_HEIGHT;
  const styleVars = {
    '--wheel-height': `${viewHeight}px`,
    '--item-height': `${itemHeight}px`,
    '--separator-height': `${separatorHeight}px`,
    '--column-width': `${columnWidth}px`,
  } as React.CSSProperties;

  useEffect(() => {
    if (value) {
      setInternalValue(value);
    }
  }, [value]);

  const updateValue = (patch: Partial<TimeWheelValue>) => {
    const nextValue = { ...currentValue, ...patch };
    if (onChange) {
      onChange(nextValue);
    } else if (!value) {
      setInternalValue(nextValue);
    }
  };

  return (
    <div
      className={`time-wheel flex items-center justify-center ${!interactive ? 'time-wheel--locked' : ''} ${className ?? ''}`}
      style={styleVars}
      role="group"
      aria-label="Time picker"
    >
      <div className="time-wheel-row flex items-center">
        <WheelColumn
          label="Hours"
          values={DIGITS_0_5}
          value={currentValue.hour}
          itemHeight={itemHeight}
          viewHeight={viewHeight}
          columnWidth={columnWidth}
          interactive={interactive}
          animate={animate}
          onChange={(next) => updateValue({ hour: next })}
        />
        <img className="time-wheel-separator" src={imgColon} alt=":" />
        <WheelColumn
          label="Minutes tens"
          values={DIGITS_0_5}
          value={currentValue.minuteTens}
          itemHeight={itemHeight}
          viewHeight={viewHeight}
          columnWidth={columnWidth}
          interactive={interactive}
          animate={animate}
          onChange={(next) => updateValue({ minuteTens: next })}
        />
        <WheelColumn
          label="Minutes ones"
          values={DIGITS_0_9}
          value={currentValue.minuteOnes}
          itemHeight={itemHeight}
          viewHeight={viewHeight}
          columnWidth={columnWidth}
          interactive={interactive}
          animate={animate}
          onChange={(next) => updateValue({ minuteOnes: next })}
        />
        <img className="time-wheel-separator" src={imgColon} alt=":" />
        <WheelColumn
          label="Seconds tens"
          values={DIGITS_0_5}
          value={currentValue.secondTens}
          itemHeight={itemHeight}
          viewHeight={viewHeight}
          columnWidth={columnWidth}
          interactive={interactive}
          animate={animate}
          onChange={(next) => updateValue({ secondTens: next })}
        />
        <WheelColumn
          label="Seconds ones"
          values={DIGITS_0_9}
          value={currentValue.secondOnes}
          itemHeight={itemHeight}
          viewHeight={viewHeight}
          columnWidth={columnWidth}
          interactive={interactive}
          animate={animate}
          onChange={(next) => updateValue({ secondOnes: next })}
        />
      </div>
    </div>
  );
};

export default TimeWheelPicker;
