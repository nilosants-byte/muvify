import React, { useEffect, useRef, useState } from "react";
import { Text, TextStyle } from "react-native";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  style?: TextStyle;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** Formatador customizado — substitui prefix/suffix/decimals quando fornecido */
  format?: (n: number) => string;
}

/**
 * Anima um número de 0 até `value` usando requestAnimationFrame.
 * Evita problemas de tipos com Reanimated animatedProps em Text.
 */
export function AnimatedNumber({
  value,
  duration = 700,
  style,
  prefix = "",
  suffix = "",
  decimals = 0,
  format,
}: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startValueRef = useRef(0);

  useEffect(() => {
    startValueRef.current = displayed;
    startTimeRef.current = null;

    function step(timestamp: number) {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValueRef.current + (value - startValueRef.current) * eased;
      setDisplayed(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplayed(value);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const safeDisplayed = Number.isFinite(displayed) ? displayed : 0;
  return (
    <Text style={style}>
      {format ? format(safeDisplayed) : `${prefix}${safeDisplayed.toFixed(decimals)}${suffix}`}
    </Text>
  );
}
