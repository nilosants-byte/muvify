module.exports = function (api) {
  api.cache(true);
  const enableNativeReanimated =
    process.env.EXPO_PUBLIC_ENABLE_NATIVE_REANIMATED === "true";

  return {
    presets: ["babel-preset-expo"],
    plugins: enableNativeReanimated ? ["react-native-reanimated/plugin"] : [],
  };
};
