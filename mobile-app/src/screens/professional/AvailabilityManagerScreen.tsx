import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { trackEvent } from "../../services/analytics";
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ApiError, Availability, availabilityApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvText, MvToggle, TimeWheelPicker } from "../../components/mv";
import { MetricPill } from "../../components/professional/UXReformComponents";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { ServiceAreaInlineSection } from "./components/ServiceAreaInlineSection";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { expandRangeToQuarterHours } from "../../utils/agendaFreeSlots";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "AvailabilityManager">;

const WEEKDAYS = [
  { id: 0, short: "Dom", full: "Domingo" },
  { id: 1, short: "Seg", full: "Segunda" },
  { id: 2, short: "Ter", full: "Terça" },
  { id: 3, short: "Qua", full: "Quarta" },
  { id: 4, short: "Qui", full: "Quinta" },
  { id: 5, short: "Sex", full: "Sexta" },
  { id: 6, short: "Sáb", full: "Sábado" },
] as const;

function validateTime(value: string) {
  if (!/^\d{1,2}:\d{2}$/.test(value.trim())) return false;
  const [h, m] = value.trim().split(":").map(Number);
  return (h ?? 0) <= 23 && (m ?? 0) <= 59;
}

function padTime(value: string): string {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return value.trim();
  return `${parts[0].padStart(2, "0")}:${parts[1]}`;
}

function AddFormSheet({ visible, title, onClose, children }: {
  visible: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.40)" }} activeOpacity={1} onPress={onClose} />
          <View style={{
            backgroundColor: theme.cardBg,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 20),
            borderTopWidth: 1,
            borderColor: theme.border,
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: "center", marginBottom: 14 }} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <MvText variant="semi2">{title}</MvText>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.text3} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function AvailabilityManagerScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const availabilityQuery = useAuthQuery(
    queryKeys.availability.me(),
    (token) => availabilityApi.me(token),
  );

  const items = (availabilityQuery.data ?? []) as Availability[];
  const loading = availabilityQuery.isLoading;

  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [applyToMoreDays, setApplyToMoreDays] = useState(false);
  const [extraDays, setExtraDays] = useState<Set<number>>(new Set());
  const [serviceAreaDirty, setServiceAreaDirty] = useState(false);

  // Frente 5 (segunda camada), Lote 4: ServiceAreaInlineSection tem seu
  // próprio rascunho local (pino no mapa, raio, modalidade, locais extras)
  // que só persiste com "Salvar" explícito — sair desta tela com esse
  // rascunho pendente perdia tudo em silêncio.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!serviceAreaDirty) return;
      e.preventDefault();
      Alert.alert(
        "Sair sem salvar?",
        "As alterações na área de atendimento (local, raio ou modalidade) ainda não foram salvas e serão perdidas.",
        [
          { text: "Continuar editando", style: "cancel" },
          { text: "Sair sem salvar", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, serviceAreaDirty]);

  useEffect(() => {
    const err = availabilityQuery.error;
    if (!err) return;
    const msg = err.message.toLowerCase();
    if (msg.includes("perfil") || msg.includes("profissional") || msg.includes("provider")) {
      showToast("Crie seu perfil profissional antes de configurar disponibilidade.", "error");
      navigation.goBack();
    } else {
      handleScreenError({ error: err, showToast, fallbackMessage: "Falha ao carregar disponibilidade.", navigation });
    }
  }, [availabilityQuery.error, showToast, navigation]);

  function resetAddForm() {
    setShowAddForm(false);
    setStartTime("08:00");
    setEndTime("09:00");
    setApplyToMoreDays(false);
    setExtraDays(new Set());
  }

  function toggleExtraDay(dayId: number) {
    setExtraDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  }

  async function addSlot() {
    if (!validateTime(startTime)) { showToast("Formato inválido. Use HH:MM (ex: 07:15).", "error"); return; }
    if (!validateTime(endTime)) { showToast("Formato inválido. Use HH:MM (ex: 08:00).", "error"); return; }
    if (startTime >= endTime) { showToast("Horário inicial deve ser menor que o final.", "error"); return; }

    const allDays = [selectedDay, ...(applyToMoreDays ? Array.from(extraDays) : [])];

    const paddedStart = padTime(startTime);
    const paddedEnd = padTime(endTime);
    const duplicateDay = allDays.find((day) =>
      items.some((i) => i.weekday === day && i.startTime === paddedStart && i.endTime === paddedEnd && i.isActive)
    );
    if (duplicateDay !== undefined) {
      showToast("Já existe um horário idêntico neste dia.", "error");
      return;
    }

    try {
      setSaving(true);
      // Frente 5 (Descoberta, agendamento e agenda), Lote 6: Promise.all
      // falhava tudo-ou-nada se um único dia conflitasse (cada dia tem seu
      // próprio conjunto de slots) — os dias que já tinham sido criados
      // com sucesso ficavam invisíveis no cache local até a próxima carga
      // da tela, e a mensagem sugeria falha total.
      const results = await Promise.allSettled(
        allDays.map((day) =>
          runWithAuth((token) =>
            availabilityApi.create(token, {
              weekday: day,
              startTime: padTime(startTime),
              endTime: padTime(endTime),
              isActive: true,
            })
          )
        )
      );
      const failedDays = allDays.filter((_, index) => results[index]?.status === "rejected");
      const succeededCount = allDays.length - failedDays.length;

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      trackEvent("availability_slot_added", { days_count: succeededCount });

      if (failedDays.length === 0) {
        showToast(succeededCount > 1 ? `Horário adicionado em ${succeededCount} dias.` : "Horário adicionado.", "success");
        resetAddForm();
      } else if (succeededCount > 0) {
        const failedLabels = failedDays.map((day) => WEEKDAYS.find((w) => w.id === day)?.short ?? String(day)).join(", ");
        showToast(`Adicionado em ${succeededCount} dia(s). Falhou em: ${failedLabels}.`, "error");
      } else {
        showToast("Falha ao adicionar horário em todos os dias selecionados.", "error");
      }
      void availabilityQuery.refetch();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.toLowerCase().includes("perfil") || msg.toLowerCase().includes("profissional") || msg.toLowerCase().includes("provider")) {
        showToast("Crie seu perfil profissional antes de adicionar horários.", "error");
        navigation.goBack();
      } else {
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao adicionar horário.", navigation });
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteSlot(id: string, force = false) {
    Alert.alert("Remover horário", "Deseja remover este horário?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover", style: "destructive",
        onPress: async () => {
          try {
            setDeletingId(id);
            await runWithAuth((token) => availabilityApi.delete(token, id, force));
            queryClient.setQueryData<Availability[]>(queryKeys.availability.me(), (old) =>
              (old ?? []).filter((item) => item.id !== id)
            );
            showToast("Horário removido.", "success");
          } catch (error) {
            // Frente 5 (Descoberta, agendamento e agenda), Lote 6: 409 aqui
            // significa que há agendamento futuro marcado dentro desse
            // horário — pede confirmação extra em vez de bloquear de vez.
            if (error instanceof ApiError && error.status === 409 && !force) {
              setDeletingId(null);
              Alert.alert("Existem agendamentos marcados", error.message, [
                { text: "Cancelar", style: "cancel" },
                { text: "Remover mesmo assim", style: "destructive", onPress: () => void deleteSlot(id, true) },
              ]);
              return;
            }
            handleScreenError({ error, showToast, fallbackMessage: "Falha ao remover horário.", navigation });
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }

  const daySlots = items
    .filter((item) => item.weekday === selectedDay)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const slotCountByDay: Record<number, number> = {};
  items.forEach((item) => {
    slotCountByDay[item.weekday] = (slotCountByDay[item.weekday] ?? 0) + 1;
  });

  const activeDaysCount = new Set(items.map((i) => i.weekday)).size;
  const selectedDayFull = WEEKDAYS.find((d) => d.id === selectedDay)?.full ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Horários e Locais" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        <MvText variant="body4" color="secondary">
          Selecione um dia para ver e gerenciar os horários disponíveis.
        </MvText>

        {/* Métricas rápidas */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <MetricPill label="Total de slots" value={items.length} tone={items.length > 0 ? "green" : "sky"} />
          <MetricPill label="Dias ativos" value={activeDaysCount} tone={activeDaysCount > 0 ? "green" : "sky"} />
          <MetricPill label={selectedDayFull} value={daySlots.length} tone={daySlots.length > 0 ? "green" : "sky"} />
        </View>

        {/* Barra semanal */}
        <View style={{
          flexDirection: "row",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.border,
          overflow: "hidden",
          backgroundColor: theme.inputBg,
        }}>
          {WEEKDAYS.map((day, index) => {
            const isSelected = selectedDay === day.id;
            const count = slotCountByDay[day.id] ?? 0;
            const hasSlots = count > 0;
            return (
              <TouchableOpacity
                key={day.id}
                onPress={() => {
                  setSelectedDay(day.id);
                  resetAddForm();
                }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  minHeight: 68,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  backgroundColor: isSelected ? "rgba(36,230,109,0.13)" : "transparent",
                  borderRightWidth: index < 6 ? 1 : 0,
                  borderRightColor: theme.border,
                }}
              >
                <MvText
                  variant="body4"
                  style={{
                    fontSize: 10,
                    fontWeight: isSelected ? "700" : "400",
                    color: isSelected ? theme.textGreen : theme.text2,
                  }}
                >
                  {day.short}
                </MvText>
                <View style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: hasSlots
                    ? isSelected
                      ? theme.textGreen
                      : "rgba(34,197,94,0.45)"
                    : "transparent",
                  borderWidth: hasSlots ? 0 : 1,
                  borderColor: theme.border,
                }} />
                {hasSlots ? (
                  <MvText
                    variant="body4"
                    style={{ fontSize: 11, color: isSelected ? theme.textGreen : theme.text3 }}
                  >
                    {count}
                  </MvText>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Cabeçalho do dia selecionado */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <MvText variant="semi2">{selectedDayFull}</MvText>
          <MvText variant="body4" color="secondary">
            {daySlots.length === 0
              ? "Sem horários"
              : `${daySlots.length} horário${daySlots.length > 1 ? "s" : ""}`}
          </MvText>
        </View>

        {/* Lista de slots do dia */}
        {daySlots.length > 0 ? (
          <MvCard>
            <View style={{ gap: 8 }}>
              {daySlots.map((item) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.inputBg,
                    gap: 10,
                  }}
                >
                  <View style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.textGreen,
                    flexShrink: 0,
                  }} />
                  <MvText variant="semi3" style={{ flex: 1 }}>
                    {item.startTime} – {item.endTime}
                  </MvText>
                  <TouchableOpacity
                    onPress={() => void deleteSlot(item.id)}
                    disabled={deletingId === item.id}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Excluir horário ${item.startTime} às ${item.endTime}`}
                    style={{ padding: 4 }}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={deletingId === item.id ? theme.text3 : "rgba(239,68,68,0.60)"}
                    />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </MvCard>
        ) : (
          <View style={{
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 14,
            padding: 28,
            alignItems: "center",
            gap: 10,
          }}>
            <Ionicons name="time-outline" size={32} color={theme.text3} />
            <MvText variant="body4" color="secondary">
              Sem horários para {selectedDayFull.toLowerCase()}.
            </MvText>
            <TouchableOpacity
              onPress={() => setShowAddForm(true)}
              style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "rgba(34,197,94,0.30)", backgroundColor: theme.primarySubtle }}
            >
              <MvText variant="semi3" style={{ color: theme.textGreen, fontSize: 12 }}>+ Adicionar horário</MvText>
            </TouchableOpacity>
          </View>
        )}

        <MvButton
          variant="outline"
          label={`+ Adicionar horário para ${selectedDayFull.toLowerCase()}`}
          onPress={() => setShowAddForm(true)}
        />

        {/* Área de atendimento */}
        <ServiceAreaInlineSection navigation={navigation as any} onDirtyChange={setServiceAreaDirty} />
      </ScrollView>

      {/* Bottom sheet — novo horário */}
      <AddFormSheet
        visible={showAddForm}
        title={`Novo horário — ${selectedDayFull}`}
        onClose={resetAddForm}
      >
        <View style={{ gap: 14, paddingBottom: 16 }}>
          {/* Horários */}
          {(() => {
            const usedTimes = daySlots.flatMap((s) => expandRangeToQuarterHours(s.startTime, s.endTime));
            return (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>Início</MvText>
                  <TimeWheelPicker
                    value={startTime}
                    onChange={setStartTime}
                    unavailableTimes={usedTimes}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>Fim</MvText>
                  <TimeWheelPicker
                    value={endTime}
                    onChange={setEndTime}
                    unavailableTimes={usedTimes}
                  />
                </View>
              </View>
            );
          })()}

          {/* Toggle — aplicar em outros dias */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              setApplyToMoreDays((v) => !v);
              setExtraDays(new Set());
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: applyToMoreDays ? "rgba(34,197,94,0.45)" : theme.border,
              backgroundColor: applyToMoreDays ? theme.primarySubtle : theme.inputBg,
            }}
          >
            <MvText variant="body4" style={{ color: theme.text1 }}>
              Aplicar também em outros dias
            </MvText>
            <MvToggle value={applyToMoreDays} onValueChange={(v) => { setApplyToMoreDays(v); setExtraDays(new Set()); }} accessibilityLabel="Aplicar também em outros dias" />
          </TouchableOpacity>

          {/* Seleção de dias extras */}
          {applyToMoreDays ? (
            <View>
              <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>
                Selecione os dias adicionais:
              </MvText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {WEEKDAYS.filter((d) => d.id !== selectedDay).map((day) => {
                  const sel = extraDays.has(day.id);
                  return (
                    <TouchableOpacity
                      key={day.id}
                      activeOpacity={0.75}
                      onPress={() => toggleExtraDay(day.id)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: sel ? theme.primary : theme.border,
                        backgroundColor: sel ? theme.primarySubtle : theme.inputBg,
                      }}
                    >
                      <MvText
                        variant="body4"
                        style={{
                          color: sel ? theme.textGreen : theme.text2,
                          fontWeight: sel ? "700" : "400",
                        }}
                      >
                        {day.full}
                      </MvText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Botões */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MvButton variant="outline" label="Cancelar" onPress={resetAddForm} />
            </View>
            <View style={{ flex: 1 }}>
              <MvButton label="Confirmar" loading={saving} onPress={() => void addSlot()} />
            </View>
          </View>
        </View>
      </AddFormSheet>
    </View>
  );
}
