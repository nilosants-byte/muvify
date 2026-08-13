import "react-native-gesture-handler/jestSetup";

// Frente 12 (segunda camada), Lote 8: AnimatedNumber anima via
// requestAnimationFrame real (não mockado) — cada instância renderizada em
// teste custa ~700ms de tempo de parede real (o duration default) e
// dispara setState fora de act() a cada frame, gerando o warning "not
// wrapped in act(...)" que aparecia em quase toda rodada da suíte inteira.
// Mock renderiza o valor final direto, sem animação nem timer real —
// elimina o warning e corta tempo real de execução (a tela renderiza o
// número final, que é tudo que os testes checam mesmo).
jest.mock("./src/components/polish/AnimatedNumber", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    AnimatedNumber: ({ value, style, prefix = "", suffix = "", decimals = 0, format }: any) => {
      const safeValue = Number.isFinite(value) ? value : 0;
      const text = format ? format(safeValue) : `${prefix}${safeValue.toFixed(decimals)}${suffix}`;
      return React.createElement(Text, { style }, text);
    }
  };
});

// Frente 12 (segunda camada), Lote 9: expo-haptics não tinha mock nenhum
// (chamada de módulo nativo real dentro do ambiente Jest); hapticAchievement
// especificamente tem um `setTimeout` real de 300ms na própria lógica
// (não no módulo nativo), disparado fire-and-forget a partir de useEffect
// em telas de conquista (ClientProfileScreen, CommunityScreen,
// AchievementsModal) — timer real que pode continuar rodando depois do
// teste desmontar o componente. Mock substitui as funções por no-ops.
jest.mock("./src/utils/haptics", () => ({
  hapticCta: jest.fn(),
  hapticPaymentSuccess: jest.fn(),
  hapticCodeValidated: jest.fn(),
  hapticWorkoutStart: jest.fn(),
  hapticWorkoutFinish: jest.fn(),
  hapticAchievement: jest.fn().mockResolvedValue(undefined),
  hapticRefresh: jest.fn(),
  hapticLike: jest.fn(),
  hapticComment: jest.fn()
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" }
}));

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn()
}));

jest.mock("expo-task-manager", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn(),
  unregisterAllTasksAsync: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("expo-device", () => ({
  isDevice: true,
  deviceName: "Jest Device"
}));

jest.mock("expo-constants", () => ({
  easConfig: {
    projectId: "test-project-id"
  },
  expoConfig: {
    version: "1.0.0",
    extra: {
      eas: {
        projectId: "test-project-id"
      }
    }
  }
}));

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({
    data: "ExponentPushToken[testPushToken123]"
  }),
  AndroidImportance: {
    MAX: 5
  }
}));

jest.mock("expo-linear-gradient", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement(View, props, children)
  };
});

jest.mock("@expo/vector-icons", () => ({
  MaterialIcons: () => null,
  Ionicons: () => null,
  MaterialCommunityIcons: () => null
}));

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: jest.fn((callback: (scope: { setContext: jest.Mock }) => void) =>
    callback({ setContext: jest.fn() })
  ),
  setUser: jest.fn(),
  // Frente 13 (segunda camada), Lote 14: addBreadcrumb (usado pelo novo
  // addNavigationBreadcrumb) faltava aqui — qualquer teste que montasse
  // root-stack.tsx (NavigationContainer.onStateChange chama isso a cada
  // troca de tela) quebraria com "Sentry.addBreadcrumb is not a function".
  addBreadcrumb: jest.fn(),
  wrap: jest.fn((component: unknown) => component)
}));

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  launchCameraAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [
      {
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+gR8V7QAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        uri: "file://selfie-proof.png"
      }
    ]
  }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [
      {
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+gR8V7QAAAABJRU5ErkJggg==",
        mimeType: "image/png",
        uri: "file://selfie-proof.png"
      }
    ]
  }),
  CameraType: {
    front: "front",
    back: "back"
  },
  MediaTypeOptions: {
    Images: "Images"
  }
}));

jest.mock("expo-image", () => {
  const React = require("react");
  const { Image: RNImage } = require("react-native");
  return {
    Image: ({ source, ...props }: any) =>
      React.createElement(RNImage, { ...props, source }, undefined)
  };
});

jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    CameraView: ({ children, ...props }: any) => React.createElement(View, props, children),
    useCameraPermissions: () => [{ granted: true }, jest.fn().mockResolvedValue({ granted: true })]
  };
});

jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MockWebView = ({ children, ...props }: any) => React.createElement(View, props, children);
  return {
    __esModule: true,
    default: MockWebView,
    WebView: MockWebView
  };
});

jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const SafeAreaInsetsContext = React.createContext(insets);
  const SafeAreaFrameContext = React.createContext(frame);

  const SafeAreaProvider = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      SafeAreaFrameContext.Provider,
      { value: frame },
      React.createElement(SafeAreaInsetsContext.Provider, { value: insets }, children)
    );

  const SafeAreaView = ({ children, ...props }: any) => React.createElement(View, props, children);

  return {
    __esModule: true,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    SafeAreaProvider,
    SafeAreaView,
    SafeAreaConsumer: ({ children }: { children: (inset: typeof insets) => React.ReactNode }) => children(insets),
    useSafeAreaInsets: () => React.useContext(SafeAreaInsetsContext),
    useSafeAreaFrame: () => React.useContext(SafeAreaFrameContext),
    withSafeAreaInsets: (Component: React.ComponentType<any>) => (props: Record<string, unknown>) =>
      React.createElement(Component, { ...props, insets }),
    initialWindowMetrics: { insets, frame }
  };
});

jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { View } = require("react-native");
  return ({ children, ...props }: any) => React.createElement(View, props, children);
});

afterEach(() => {
  jest.clearAllMocks();
});
