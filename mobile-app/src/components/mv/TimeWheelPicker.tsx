import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "./MvText";
import { WheelPickerColumn } from "./WheelPickerColumn";

const HOUR_RANGE = Array.from({ length: 18 }, (_, i) => i + 5); // 05..22
const MINUTES = [0, 15, 30, 45];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseTime(time: string): { h: number; m: number } {
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "8", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  return { h: isNaN(h) ? 8 : h, m: isNaN(m) ? 0 : m };
}

function snapMinute(m: number): number {
  return MINUTES.reduce((prev, cur) => (Math.abs(cur - m) < Math.abs(prev - m) ? cur : prev), MINUTES[0]!);
}

interface Props {
  value: string;
  onChange: (time: string) => void;
  unavailableTimes?: string[];
}

export function TimeWheelPicker({ value, onChange, unavailableTimes = [] }: Props) {
  const { theme } = useMvTheme();
  const usedSet = useMemo(() => new Set(unavailableTimes), [unavailableTimes]);

  const { h: initH, m: initM } = parseTime(value);

  const computeValidHour = (h: number, used: Set<string>) => {
    const available = HOUR_RANGE.filter((hour) =>
      MINUTES.some((min) => !used.has(`${pad2(hour)}:${pad2(min)}`))
    );
    return available.includes(h) ? h : (available[0] ?? h);
  };

  const computeValidMinute = (h: number, m: number, used: Set<string>) => {
    const snapped = snapMinute(m);
    const available = MINUTES.filter((min) => !used.has(`${pad2(h)}:${pad2(min)}`));
    return available.includes(snapped) ? snapped : (available[0] ?? snapped);
  };

  const [selectedHour, setSelectedHour] = useState(() => computeValidHour(initH, usedSet));
  const [selectedMinute, setSelectedMinute] = useState(() =>
    computeValidMinute(computeValidHour(initH, usedSet), initM, usedSet)
  );

  const hourItems = useMemo(
    () =>
      HOUR_RANGE.filter((h) => MINUTES.some((m) => !usedSet.has(`${pad2(h)}:${pad2(m)}`))).map(
        (h) => ({ label: pad2(h), value: h })
      ),
    [usedSet]
  );

  const minuteItems = useMemo(
    () =>
      MINUTES.filter((m) => !usedSet.has(`${pad2(selectedHour)}:${pad2(m)}`)).map((m) => ({
        label: pad2(m),
        value: m,
      })),
    [selectedHour, usedSet]
  );

  const handleHourChange = (h: number) => {
    const available = MINUTES.filter((m) => !usedSet.has(`${pad2(h)}:${pad2(m)}`));
    const newMinute = available.includes(selectedMinute) ? selectedMinute : (available[0] ?? selectedMinute);
    setSelectedHour(h);
    setSelectedMinute(newMinute);
    onChange(`${pad2(h)}:${pad2(newMinute)}`);
  };

  const handleMinuteChange = (m: number) => {
    setSelectedMinute(m);
    onChange(`${pad2(selectedHour)}:${pad2(m)}`);
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.cardBg,
        overflow: "hidden",
        paddingHorizontal: 8,
      }}
    >
      <WheelPickerColumn
        items={hourItems}
        selectedValue={selectedHour}
        onChange={handleHourChange}
        width={72}
      />
      <MvText
        variant="semi1"
        style={{ color: theme.text2, fontSize: 26, paddingHorizontal: 2, lineHeight: 32 }}
      >
        :
      </MvText>
      <WheelPickerColumn
        items={minuteItems}
        selectedValue={selectedMinute}
        onChange={handleMinuteChange}
        width={72}
      />
    </View>
  );
}
