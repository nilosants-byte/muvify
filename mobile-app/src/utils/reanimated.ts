import { Animated as RNAnimated, Easing as RNEasing } from "react-native";
import Constants from "expo-constants";

const executionEnvironment = (Constants as any)?.executionEnvironment;
const appOwnership = (Constants as any)?.appOwnership;
const isExpoGo =
  executionEnvironment === "storeClient" ||
  appOwnership === "expo" ||
  Boolean((globalThis as any)?.expo);

// Native reanimated is opt-in to keep Expo Go flow stable by default.
// Enable only when running a custom dev/preview build:
// EXPO_PUBLIC_ENABLE_NATIVE_REANIMATED=true
const enableNativeReanimated =
  typeof process !== "undefined" &&
  process.env.EXPO_PUBLIC_ENABLE_NATIVE_REANIMATED === "true";

let reanimated: any = null;
if (enableNativeReanimated && !isExpoGo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    reanimated = require("react-native-reanimated");
  } catch {
    reanimated = null;
  }
}

const Animated = reanimated?.default ?? RNAnimated;

const useSharedValue = reanimated?.useSharedValue ?? ((value: number | string) => ({ value }));
const useAnimatedStyle = reanimated?.useAnimatedStyle ?? ((fn: () => any) => fn());
const withTiming = reanimated?.withTiming ?? ((value: any) => value);
const withSpring = reanimated?.withSpring ?? ((value: any) => value);
const withSequence = reanimated?.withSequence ?? ((...values: any[]) => values[values.length - 1]);
const withRepeat = reanimated?.withRepeat ?? ((value: any) => value);
const withDelay = reanimated?.withDelay ?? ((_: number, value: any) => value);
const Easing = reanimated?.Easing ?? RNEasing;

const interpolate =
  reanimated?.interpolate ??
  ((input: any, inputRange: number[], outputRange: number[]) => {
    const value = typeof input === "number" ? input : input?.value ?? 0;
    if (inputRange.length < 2 || outputRange.length < 2) return outputRange[0] ?? value;
    const [inMin, inMax] = inputRange;
    const [outMin, outMax] = outputRange;
    if (inMax === inMin) return outMin;
    const ratio = (value - inMin) / (inMax - inMin);
    return outMin + ratio * (outMax - outMin);
  });

const runOnJS = reanimated?.runOnJS ?? ((fn: (...args: any[]) => void) => fn);

export default Animated;

export {
  Animated,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  runOnJS,
};
