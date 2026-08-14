import React from "react";
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MvAvatar } from "../../../components/mv";
import { MvVideoPlayer } from "../../../components/mv/MvVideoPlayer";
import { resolveMediaUrl } from "../../../utils/media";
import { hapticCta } from "../../../utils/haptics";
import { C, S, DISPLAY } from "../../../theme/v2tokens";
import { useMvTheme } from "../../../theme/MvThemeContext";

export type ScheduleDay = {
  date: string;
  label: string;
  availableSlots: string[];
  occupiedSlots: string[];
};

export type ProviderModalData = {
  id: string;
  displayName: string;
  age?: number | null;
  priceCents: number;
  photoUrl?: string | null;
  presentationVideoUrl?: string | null;
};

type Props = {
  visible: boolean;
  provider: ProviderModalData | null;
  detailLoading: boolean;
  specialties: string[];
  scheduleLoading: boolean;
  scheduleDays: ScheduleDay[];
  selectedDay: string | null;
  selectedDayPayload: ScheduleDay | null;
  onSelectDay: (day: string | null) => void;
  onClose: () => void;
  onBook: (providerId: string) => void;
  onViewProfile: (providerId: string) => void;
  onChat: (providerId: string) => void;
};

function getInitials(name?: string | null) {
  const parts = (name ?? "?").trim().split(/\s+/);
  if (parts.length <= 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function formatPrice(cents: number) {
  try {
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${(cents / 100).toFixed(2)}`;
  }
}

export const ClientProviderCard = React.memo(function ClientProviderCard({
  visible,
  provider,
  detailLoading,
  specialties,
  scheduleLoading,
  scheduleDays,
  selectedDay,
  selectedDayPayload,
  onSelectDay,
  onClose,
  onBook,
  onViewProfile,
  onChat,
}: Props) {
  const { theme, isDark } = useMvTheme();
  const isLight = !isDark;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.30)" }}
          onPress={onClose}
        />
        <View
          style={{
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.bg,
            padding: 16,
            paddingBottom: 36,
            gap: 12,
          }}
        >
          {/* Handle */}
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center" }} />

          {detailLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.cardBg, borderWidth: 1, borderColor: theme.border }} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ height: 14, borderRadius: 7, backgroundColor: theme.cardBg, width: "60%" }} />
                <View style={{ height: 11, borderRadius: 6, backgroundColor: theme.cardBg, width: "40%" }} />
              </View>
            </View>
          ) : provider ? (
            <>
              {/* Header: avatar + nome + preço + fechar */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <MvAvatar
                  initials={getInitials(provider.displayName)}
                  photoUri={resolveMediaUrl(provider.photoUrl)}
                  tone="green"
                  size={52 as any}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 17, color: theme.text1, letterSpacing: -0.02 * 17 }} numberOfLines={1}>
                    {provider.displayName}
                  </Text>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
                    {formatPrice(provider.priceCents)}<Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>/aula</Text>
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", borderWidth: 1, borderColor: theme.border }}
                >
                  <Ionicons name="close" size={16} color={theme.text2} />
                </TouchableOpacity>
              </View>

              {/* Vídeo de apresentação */}
              {provider.presentationVideoUrl && (
                <MvVideoPlayer
                  url={resolveMediaUrl(provider.presentationVideoUrl) ?? provider.presentationVideoUrl}
                  height={140}
                  borderRadius={12}
                />
              )}

              {/* Especialidades — chips horizontais */}
              {specialties.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {specialties.slice(0, 8).map((item) => (
                    <View key={item} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>{item}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}

              {/* Disponibilidade compacta — próximos dias */}
              {!scheduleLoading && scheduleDays.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {scheduleDays.slice(0, 5).map((day) => {
                    const active = selectedDay === day.date;
                    const hasSlots = day.availableSlots.length > 0;
                    return (
                      <TouchableOpacity
                        key={day.date}
                        onPress={() => onSelectDay(active ? null : day.date)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${day.label}, ${hasSlots ? "com horário disponível" : "sem horário disponível"}`}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: active ? theme.primarySubtleBorder : theme.border, backgroundColor: active ? theme.primarySubtle : "transparent", alignItems: "center", gap: 3 }}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: hasSlots ? theme.primary : theme.text3 }} />
                        <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: active ? theme.primary : theme.text3 }}>{day.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* Horários do dia selecionado */}
              {selectedDayPayload && selectedDayPayload.availableSlots.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {selectedDayPayload.availableSlots.slice(0, 6).map((slot) => (
                    <View key={`free-${slot}`} style={{ borderRadius: 8, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>{slot}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Ações secundárias */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => { hapticCta(); onChat(provider.id); }}
                  style={{ flex: 1, height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.border, backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}
                >
                  <Ionicons name="chatbubble-outline" size={15} color={theme.text2} />
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.text2 }}>Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { hapticCta(); onViewProfile(provider.id); }}
                  style={{ flex: 1, height: S.btnH, borderRadius: S.btnR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}
                >
                  <Ionicons name="person-outline" size={15} color={theme.textGreen} />
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textGreen }}>Ver perfil</Text>
                </TouchableOpacity>
              </View>

              {/* Agendar */}
              <TouchableOpacity
                onPress={() => { hapticCta(); onBook(provider.id); }}
                style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
              >
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Agendar aula</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
});
