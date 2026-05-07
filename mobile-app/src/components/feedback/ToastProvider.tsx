import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { AppText } from '../ui/AppText';
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

type ToastTone = "success" | "error" | "info" | "offline";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
  hideToast: () => void;
}

const DURATION_BY_TONE: Record<ToastTone, number> = {
  success: 2200,
  info: 2600,
  offline: 3200,
  error: 4000,
};

const TOAST_MAX_WIDTH = 480;
let toastIdCounter = 0;

const ToastContext = createContext<ToastContextValue | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    container: {
      position: "absolute",
      zIndex: theme.zIndex.toast,
      alignItems: "center",
    },
    toast: {
      width: "100%",
      minHeight: 54,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderRadius: theme.radius.xl,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: "row",
      gap: theme.spacing.sm,
      alignItems: "center",
      ...theme.shadows.card,
    },
    text: {
      flex: 1,
    },
    queueBadge: {
      minWidth: 24,
      textAlign: "right",
    },
  }));
  const TONE_MAP: Record<
    ToastTone,
    { icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: string; borderColor: string }
  > = {
    success: {
      icon: "check-circle",
      color: colors.primary,
      borderColor: colors.primarySoft,
    },
    error: {
      icon: "error",
      color: colors.danger,
      borderColor: colors.danger,
    },
    info: {
      icon: "info",
      color: colors.info,
      borderColor: colors.border,
    },
    offline: {
      icon: "wifi-off",
      color: colors.offline,
      borderColor: colors.border,
    },
  } as const;

  const toastBottom = Math.max(theme.spacing.xl, insets.bottom + theme.spacing.md);
  const toastSideMargin = theme.spacing.lg;
  const toastWidth = Math.min(screenWidth - toastSideMargin * 2, TOAST_MAX_WIDTH);

  const showNext = useCallback(
    (item: ToastItem) => {
      setCurrent(item);
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        Animated.timing(anim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setCurrent(null);
          setQueue((q) => q.slice(1));
        });
      }, DURATION_BY_TONE[item.tone]);
    },
    [anim],
  );

  useEffect(() => {
    if (current === null && queue.length > 0) {
      showNext(queue[0]);
    }
  }, [current, queue, showNext]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const hideToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(anim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setCurrent(null);
      setQueue((q) => q.slice(1));
    });
  }, [anim]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const item: ToastItem = { id: ++toastIdCounter, message, tone };
    setQueue((q) => [...q, item]);
  }, []);

  const value = useMemo(
    () => ({
      showToast,
      hideToast,
    }),
    [hideToast, showToast],
  );
  const config = current ? TONE_MAP[current.tone] : TONE_MAP.info;
  const opacity = anim;
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  return (
    <ToastContext.Provider value={value}>
      {children}
      {current ? (
        <View
          pointerEvents="none"
          style={[
            styles.container,
            {
              bottom: toastBottom,
              left: toastSideMargin,
              right: toastSideMargin,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.toast,
              { borderColor: config.borderColor, maxWidth: toastWidth },
              { opacity, transform: [{ translateY }] },
            ]}
            accessibilityLiveRegion="polite"
            accessibilityRole={current.tone === "error" ? "alert" : "text"}
            accessible
            accessibilityLabel={current.message}
          >
            <MaterialIcons color={config.color} name={config.icon} size={20} />
            <AppText style={styles.text} variant="captionStrong">
              {current.message}
            </AppText>
            {queue.length > 1 ? (
              <AppText style={styles.queueBadge} variant="label" color={colors.textSecondary}>
                +{queue.length - 1}
              </AppText>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de ToastProvider.");
  }
  return context;
}
