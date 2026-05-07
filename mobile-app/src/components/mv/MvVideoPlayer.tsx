import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "./MvText";

type Props = {
  url: string;
  height?: number;
  borderRadius?: number;
};

type VideoSource = {
  source: { uri: string } | { html: string };
  youTubeThumbnail?: string;
  isLocalFile?: boolean;
};

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s?/]+)/i);
  return match?.[1] ?? null;
}

function getYouTubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildInlineVideoHtml(videoUrl: string): string {
  const safeUrl = escapeHtml(videoUrl);
  return `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; }
      video { width: 100%; height: 100%; object-fit: contain; background: #000; }
    </style>
  </head>
  <body>
    <video src="${safeUrl}" controls autoplay playsinline webkit-playsinline></video>
  </body>
</html>`;
}

function buildYouTubeEmbedUri(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=1&fs=1`;
}

// User agent de browser mobile para não ser bloqueado pelo YouTube
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function buildVideoSource(url: string): VideoSource | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const ytId = getYouTubeId(trimmed);
  if (ytId) {
    return {
      source: { uri: buildYouTubeEmbedUri(ytId) },
      youTubeThumbnail: getYouTubeThumbnail(ytId),
    };
  }

  // data:video/ URIs are 30-40MB base64 strings — passing them to WebView exhausts
  // mobile memory and crashes the app. Caller must use file:// for local preview.
  if (/^data:video\//i.test(trimmed)) {
    return null;
  }

  // Local files (file:// or content://) must use direct URI — HTML-based WebView
  // cannot access the file system for security reasons.
  const isLocalFile =
    /^file:\/\//i.test(trimmed) ||
    /^content:\/\//i.test(trimmed);

  if (isLocalFile) {
    return {
      source: { uri: trimmed },
      isLocalFile: true,
    };
  }

  const isLikelyRemoteVideo =
    /^https?:\/\//i.test(trimmed) ||
    /\.(mp4|mov|webm|m3u8)(\?.*)?$/i.test(trimmed);

  if (!isLikelyRemoteVideo) return null;

  return {
    source: { html: buildInlineVideoHtml(trimmed) },
  };
}

export function MvVideoPlayer({ url, height = 200, borderRadius = 12 }: Props) {
  const { theme } = useMvTheme();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  const videoSource = useMemo(() => buildVideoSource(url), [url]);

  if (!videoSource) return null;

  if (!playing) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setPlaying(true)}
        style={{ borderRadius, overflow: "hidden", height }}
      >
        {videoSource.youTubeThumbnail ? (
          <Image
            source={{ uri: videoSource.youTubeThumbnail }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: theme.chipBg, alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Ionicons name="play-circle-outline" size={34} color={theme.textGreen} />
            <MvText variant="body4" color="secondary">Toque para reproduzir</MvText>
          </View>
        )}

        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.30)",
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: videoSource.youTubeThumbnail
                ? "rgba(255,0,0,0.88)"
                : "rgba(76,175,80,0.88)",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.35,
              shadowRadius: 8,
              elevation: 6,
            }}
          >
            <Ionicons name="play" size={22} color="#fff" style={{ marginLeft: 3 }} />
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{ borderRadius, overflow: "hidden", height }}>
      {loading ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.chipBg,
            zIndex: 1,
          }}
        >
          <ActivityIndicator color={theme.textGreen} />
        </View>
      ) : null}

      <WebView
        source={videoSource.source}
        originWhitelist={["*"]}
        style={{ flex: 1 }}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowFileAccess={videoSource.isLocalFile}
        allowUniversalAccessFromFileURLs={videoSource.isLocalFile}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        thirdPartyCookiesEnabled
        userAgent={MOBILE_UA}
      />

      <TouchableOpacity
        onPress={() => {
          setPlaying(false);
          setLoading(true);
        }}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
        }}
      >
        <Ionicons name="close" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
