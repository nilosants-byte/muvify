import React from "react";
import Svg, { Circle, Line, Path, Polyline, Polygon, Rect } from "react-native-svg";

export type IconProps = {
  color?: string;
  size?: number;
  strokeWidth?: number;
};

export const IconHome = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconSearch = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="11" cy="11" r="8" stroke={color} strokeWidth={strokeWidth} />
    <Path d="m21 21-4.35-4.35" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconWorkout = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 4H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M18 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Rect x="6" y="8" width="12" height="8" rx="2" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const IconCalendar = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth={strokeWidth} />
    <Line x1="16" y1="2" x2="16" y2="6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="8" y1="2" x2="8" y2="6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth={strokeWidth} />
  </Svg>
);

export const IconProfile = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={strokeWidth} />
    <Path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconBell = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path d="M13.73 21a2 2 0 0 1-3.46 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
  </Svg>
);

export const IconRevenue = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Line x1="12" y1="1" x2="12" y2="23" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    <Path
      d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  </Svg>
);

export const IconHeart = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconStar = ({
  color = "#4CAF50",
  size = 12,
  filled = true,
}: IconProps & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : "none"}>
    <Polygon
      points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
      stroke={color}
      strokeWidth={filled ? 0 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconGymVenue = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Left weight plate — rounded corners, slightly taller than the handle zone */}
    <Rect
      x="2" y="8" width="4.5" height="8" rx="1.5"
      stroke={color}
      strokeWidth={strokeWidth}
    />
    {/* Left collar — thicker band between plate and grip */}
    <Line
      x1="6.5" y1="10" x2="6.5" y2="14"
      stroke={color}
      strokeWidth={strokeWidth + 1.2}
      strokeLinecap="round"
    />
    {/* Grip — central handle */}
    <Line
      x1="7" y1="12" x2="17" y2="12"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
    {/* Knurling — 3 grip notches evenly spaced */}
    <Line x1="10" y1="10.5" x2="10" y2="13.5" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
    <Line x1="12" y1="10.5" x2="12" y2="13.5" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
    <Line x1="14" y1="10.5" x2="14" y2="13.5" stroke={color} strokeWidth={strokeWidth * 0.65} strokeLinecap="round" />
    {/* Right collar */}
    <Line
      x1="17.5" y1="10" x2="17.5" y2="14"
      stroke={color}
      strokeWidth={strokeWidth + 1.2}
      strokeLinecap="round"
    />
    {/* Right weight plate */}
    <Rect
      x="17.5" y="8" width="4.5" height="8" rx="1.5"
      stroke={color}
      strokeWidth={strokeWidth}
    />
  </Svg>
);

export const IconChevronLeft = ({ color = "#fff", size = 24, strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline
      points="15 18 9 12 15 6"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconSettings = ({ color = "#fff", size = 24, strokeWidth = 1.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
    <Path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      stroke={color}
      strokeWidth={strokeWidth}
    />
  </Svg>
);
