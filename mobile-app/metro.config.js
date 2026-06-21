const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "src/web/react-native-maps.web.tsx"),
    };
  }

  if (platform === "web" && moduleName === "expo-font") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "src/web/expo-font.web.ts"),
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
