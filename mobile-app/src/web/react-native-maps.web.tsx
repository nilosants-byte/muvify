import React, { forwardRef, useImperativeHandle } from "react";
import { Pressable, View } from "react-native";

export const PROVIDER_DEFAULT = "default";

const CENTER = { latitude: -23.5505, longitude: -46.6333 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function coordinateToPercent(coordinate?: { latitude?: number; longitude?: number }) {
  const latitude = Number(coordinate?.latitude ?? CENTER.latitude);
  const longitude = Number(coordinate?.longitude ?? CENTER.longitude);
  return {
    left: `${clamp(50 + (longitude - CENTER.longitude) * 5200, 8, 92)}%`,
    top: `${clamp(50 - (latitude - CENTER.latitude) * 5200, 10, 90)}%`,
  };
}

const MapView = forwardRef(function MapViewWeb(
  { children, style }: { children?: React.ReactNode; style?: unknown },
  ref
) {
  useImperativeHandle(ref, () => ({
    animateToRegion: () => undefined,
    fitToCoordinates: () => undefined,
  }));

  return (
    <View
      style={[
        style as any,
        {
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#102116",
        },
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset: 0 as any,
          opacity: 0.9,
          backgroundColor: "#102116",
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset: 0 as any,
          opacity: 0.18,
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.25) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
        } as any}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: "-10%",
          right: "-10%",
          top: "42%",
          height: 34,
          borderRadius: 999,
          transform: [{ rotate: "-12deg" }],
          backgroundColor: "rgba(33,150,243,0.18)",
        }}
      />
      {children}
    </View>
  );
});

export function Marker({
  children,
  coordinate,
  onPress,
}: {
  children?: React.ReactNode;
  coordinate?: { latitude?: number; longitude?: number };
  onPress?: () => void;
}) {
  const position = coordinateToPercent(coordinate);
  return (
    <View
      style={{
        position: "absolute",
        left: position.left as any,
        top: position.top as any,
        transform: [{ translateX: -40 }, { translateY: -48 }],
      }}
    >
      <Pressable onPress={onPress}>{children}</Pressable>
    </View>
  );
}

export function Circle({
  center,
  radius,
  strokeColor = "#4CAF50",
  strokeWidth = 1,
  fillColor = "rgba(76,175,80,0.09)",
}: {
  center?: { latitude?: number; longitude?: number };
  radius?: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}) {
  const position = coordinateToPercent(center);
  const size = clamp(Number(radius ?? 3000) / 28, 86, 260);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: position.left as any,
        top: position.top as any,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: size / 2,
        borderColor: strokeColor,
        borderWidth: strokeWidth,
        backgroundColor: fillColor,
      }}
    />
  );
}

export default MapView;
