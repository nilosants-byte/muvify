import React, { useState } from "react";
import { ActivityIndicator, DimensionValue, Image, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ExerciseMediaType } from "../../services/api/client";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "./MvText";
import { MvVideoPlayer } from "./MvVideoPlayer";

type Props = {
  mediaUrl: string;
  mediaType: ExerciseMediaType;
  height?: number;
  // Ver MvVideoPlayer — quando passado, some com height fixo em favor de
  // { width, aspectRatio } (usado pro player vertical de Shorts no modal).
  aspectRatio?: number;
  width?: number;
  borderRadius?: number;
};

function isYouTubeUrl(url: string) {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function isVideoFile(url: string) {
  return (
    /\.(mp4|mov|webm|m3u8)(\?.*)?$/i.test(url) ||
    url.startsWith("file://") ||
    url.startsWith("data:video/")
  );
}

export function MvMediaViewer({ mediaUrl, mediaType, height = 200, aspectRatio, width, borderRadius = 12 }: Props) {
  const { theme } = useMvTheme();
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  if (!mediaUrl) return null;

  if (mediaType === "YOUTUBE" || mediaType === "VIDEO") {
    return <MvVideoPlayer url={mediaUrl} height={height} aspectRatio={aspectRatio} width={width} borderRadius={borderRadius} />;
  }

  const dimensionStyle: { width: DimensionValue; height?: number; aspectRatio?: number } = aspectRatio
    ? { width: width ?? "100%", aspectRatio }
    : { height, width: "100%" };

  if (
    mediaType === "IMAGE" ||
    mediaType === "GIF" ||
    (!isYouTubeUrl(mediaUrl) && !isVideoFile(mediaUrl))
  ) {
    if (imageError) {
      return (
        <View
          style={{
            ...dimensionStyle,
            borderRadius,
            backgroundColor: theme.chipBg,
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Ionicons name="image-outline" size={28} color={theme.text3} />
          <MvText variant="body4" color="secondary">Não foi possível carregar a mídia</MvText>
        </View>
      );
    }

    return (
      <View style={{ ...dimensionStyle, borderRadius, overflow: "hidden", backgroundColor: theme.chipBg }}>
        {imageLoading ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <ActivityIndicator color={theme.textGreen} />
          </View>
        ) : null}

        <Image
          source={{ uri: mediaUrl }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
          onLoad={() => setImageLoading(false)}
          onError={() => {
            setImageLoading(false);
            setImageError(true);
          }}
        />

        <View
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            backgroundColor: "rgba(0,0,0,0.55)",
            borderRadius: 6,
            paddingHorizontal: 7,
            paddingVertical: 3,
          }}
        >
          <MvText variant="badge" style={{ color: "#fff", fontSize: 10 }}>
            {mediaType === "GIF" ? "GIF" : "Foto"}
          </MvText>
        </View>
      </View>
    );
  }

  return null;
}
