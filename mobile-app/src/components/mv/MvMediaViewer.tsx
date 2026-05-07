import React, { useState } from "react";
import { ActivityIndicator, Image, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ExerciseMediaType } from "../../services/api/client";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "./MvText";
import { MvVideoPlayer } from "./MvVideoPlayer";

type Props = {
  mediaUrl: string;
  mediaType: ExerciseMediaType;
  height?: number;
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

export function MvMediaViewer({ mediaUrl, mediaType, height = 200, borderRadius = 12 }: Props) {
  const { theme } = useMvTheme();
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  if (!mediaUrl) return null;

  if (mediaType === "YOUTUBE" || mediaType === "VIDEO") {
    return <MvVideoPlayer url={mediaUrl} height={height} borderRadius={borderRadius} />;
  }

  if (
    mediaType === "IMAGE" ||
    mediaType === "GIF" ||
    (!isYouTubeUrl(mediaUrl) && !isVideoFile(mediaUrl))
  ) {
    if (imageError) {
      return (
        <View
          style={{
            height,
            borderRadius,
            backgroundColor: theme.chipBg,
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Ionicons name="image-outline" size={28} color={theme.text3} />
          <MvText variant="body4" color="secondary">Nao foi possivel carregar a midia</MvText>
        </View>
      );
    }

    return (
      <View style={{ height, borderRadius, overflow: "hidden", backgroundColor: theme.chipBg }}>
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

export function MvMediaPreviewButton({
  mediaType,
  expanded,
  onToggle,
}: {
  mediaUrl: string;
  mediaType: ExerciseMediaType;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { theme } = useMvTheme();

  const isVideo = mediaType === "YOUTUBE" || mediaType === "VIDEO";
  const color = isVideo ? "#FF0000" : theme.textGreen;
  const bgColor = isVideo ? "rgba(255,0,0,0.10)" : "rgba(76,175,80,0.10)";
  const borderColor = isVideo ? "rgba(255,0,0,0.28)" : "rgba(76,175,80,0.28)";

  const iconName = expanded
    ? "stop-circle-outline"
    : isVideo
    ? "logo-youtube"
    : mediaType === "GIF"
    ? "film-outline"
    : "image-outline";

  return (
    <TouchableOpacity
      onPress={onToggle}
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: expanded
          ? isVideo
            ? "rgba(255,0,0,0.20)"
            : "rgba(76,175,80,0.20)"
          : bgColor,
        borderWidth: 1,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={iconName as any} size={20} color={color} />
    </TouchableOpacity>
  );
}
