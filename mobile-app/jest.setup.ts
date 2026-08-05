import "react-native-gesture-handler/jestSetup";

// Épico de Frentes - atualização Expo 54→57/RN 0.81→0.86: o worklets/
// reanimated 4.5 carrega o módulo nativo de verdade se não for mockado
// explicitamente (antes, versões mais antigas toleravam isso em silêncio) -
// sem isso, qualquer teste que passe por um componente animado quebra com
// "Cannot read properties of undefined (reading 'loadUnpackers')".
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

// Épico de Frentes - atualização Expo 54→57/RN 0.81→0.86: react-native-maps
// 1.27 passou a usar TurboModuleRegistry.getEnforcing (lança erro se o
// módulo nativo não existir) em vez de get (retornava undefined em
// silêncio) - antes disso os testes que passam por MapView nunca
// precisaram de mock nenhum. O pacote não traz mock oficial pronto, então
// só os 4 exports que o app de fato usa (ClientHomeMapSection,
// ServiceAreaInlineSection) são mockados aqui.
jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapView = React.forwardRef((props: any, ref: any) => React.createElement(View, { ...props, ref }, props.children));
  const Marker = (props: any) => React.createElement(View, props, props.children);
  const Circle = (props: any) => React.createElement(View, props);
  return {
    __esModule: true,
    default: MapView,
    Marker,
    Circle,
    PROVIDER_DEFAULT: "default"
  };
});

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
