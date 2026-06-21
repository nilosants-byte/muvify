import React, { useEffect, useRef } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useMvTheme } from "../../theme/MvThemeContext";

const ITEM_HEIGHT = 48;
const VISIBLE_COUNT = 5;
export const WHEEL_PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT;
const PADDING = ITEM_HEIGHT * Math.floor(VISIBLE_COUNT / 2);

export interface WheelItem {
  label: string;
  value: number;
}

interface Props {
  items: WheelItem[];
  selectedValue: number;
  onChange: (value: number) => void;
  width?: number;
}

export function WheelPickerColumn({ items, selectedValue, onChange, width = 72 }: Props) {
  const { theme } = useMvTheme();
  const scrollRef = useRef<ScrollView>(null);
  const isReadyRef = useRef(false);
  const lastScrolledValueRef = useRef(selectedValue);

  const getIndex = (value: number) => {
    const idx = items.findIndex((i) => i.value === value);
    return idx >= 0 ? idx : 0;
  };

  const handleLayout = () => {
    if (isReadyRef.current) return;
    isReadyRef.current = true;
    const idx = getIndex(selectedValue);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false });
    });
  };

  useEffect(() => {
    if (!isReadyRef.current) return;
    if (selectedValue === lastScrolledValueRef.current) return;
    const idx = getIndex(selectedValue);
    lastScrolledValueRef.current = selectedValue;
    scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: true });
  }, [selectedValue, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y;
    const rawIdx = Math.round(offset / ITEM_HEIGHT);
    const idx = Math.max(0, Math.min(items.length - 1, rawIdx));
    const item = items[idx];
    if (item) {
      lastScrolledValueRef.current = item.value;
      onChange(item.value);
    }
  };

  const bgSolid = theme.cardBg;
  const bgTransparent = bgSolid + "00";

  return (
    <View style={{ width, height: WHEEL_PICKER_HEIGHT, overflow: "hidden" }} onLayout={handleLayout}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: PADDING,
          left: 4,
          right: 4,
          height: ITEM_HEIGHT,
          borderRadius: 10,
          backgroundColor: theme.primarySubtle,
          borderWidth: 1,
          borderColor: theme.primarySubtleBorder,
          zIndex: 1,
        }}
      />
      <ScrollView
        ref={scrollRef}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: PADDING }}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        scrollEventThrottle={16}
        bounces={false}
        overScrollMode="never"
      >
        {items.map((item) => {
          const isSelected = item.value === selectedValue;
          return (
            <View
              key={item.value}
              style={{ height: ITEM_HEIGHT, width, alignItems: "center", justifyContent: "center" }}
            >
              <Text
                style={{
                  fontSize: isSelected ? 22 : 16,
                  fontWeight: isSelected ? "700" : "400",
                  color: isSelected ? theme.textGreen : theme.text2,
                  opacity: isSelected ? 1 : 0.5,
                }}
              >
                {item.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      <LinearGradient
        colors={[bgSolid, bgTransparent]}
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: PADDING, zIndex: 2 }}
      />
      <LinearGradient
        colors={[bgTransparent, bgSolid]}
        pointerEvents="none"
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: PADDING, zIndex: 2 }}
      />
    </View>
  );
}
