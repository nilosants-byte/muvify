import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { Availability, availabilityApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText, MvToggle } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

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
  return /^\d{1,2}:\d{2}$/.test(value.trim());
}

function padTime(value: string): string {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return value.trim();
  return `${parts[0].padStart(2, "0")}:${parts[1]}`;
}

export function AvailabilityManagerScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<Availability[]>([]);
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [applyToMoreDays, setApplyToMoreDays] = useState(false);
  const [extraDays, setExtraDays] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await runWithAuth((token) => availabilityApi.me(token));
      setItems(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.toLowerCase().includes("perfil") || msg.toLowerCase().includes("profissional") || msg.toLowerCase().includes("provider")) {
        showToast("Crie seu perfil profissional antes de configurar disponibilidade.", "error");
        navigation.goBack();
      } else {
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar disponibilidade.", navigation });
      }
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

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

    try {
      setSaving(true);
      await Promise.all(
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
      const count = allDays.length;
      showToast(count > 1 ? `Horário adicionado em ${count} dias.` : "Horário adicionado.", "success");
      resetAddForm();
      await load();
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

  async function deleteSlot(id: string) {
    Alert.alert("Remover horário", "Deseja remover este horário?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover", style: "destructive",
        onPress: async () => {
          try {
            setDeletingId(id);
            await runWithAuth((token) => availabilityApi.delete(token, id));
            setItems((current) => current.filter((item) => item.id !== id));
            showToast("Horário removido.", "success");
          } catch (error) {
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

  const selectedDayFull = WEEKDAYS.find((d) => d.id === selectedDay)?.full ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="semi1" style={{ flex: 1 }}>Meus Horários</MvText>
        {loading ? (
          <MvText variant="body4" color="secondary">Atualizando...</MvText>
        ) : null}
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled
        maximumZoomScale={3}
      >
        <MvText variant="body4" color="secondary">
          Selecione um dia para ver e gerenciar os horários disponíveis.
        </MvText>

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
                  paddingVertical: 10,
                  alignItems: "center",
                  gap: 5,
                  backgroundColor: isSelected ? "rgba(34,197,94,0.13)" : "transparent",
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
                    style={{ fontSize: 9, color: isSelected ? theme.textGreen : theme.text3 }}
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
                    backgroundColor: "rgba(34,197,94,0.65)",
                    flexShrink: 0,
                  }} />
                  <MvText variant="semi3" style={{ flex: 1 }}>
                    {item.startTime} – {item.endTime}
                  </MvText>
                  <TouchableOpacity
                    onPress={() => void deleteSlot(item.id)}
                    disabled={deletingId === item.id}
                    hitSlop={8}
                    style={{ padding: 4 }}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={deletingId === item.id ? theme.text3 : "#f44336"}
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
            borderRadius: 12,
            padding: 24,
            alignItems: "center",
            gap: 8,
          }}>
            <Ionicons name="time-outline" size={30} color={theme.text3} />
            <MvText variant="body4" color="secondary">
              Sem horários para {selectedDayFull.toLowerCase()}.
            </MvText>
          </View>
        )}

        {/* Formulário de adição */}
        {showAddForm ? (
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 12 }}>
              Novo horário — {selectedDayFull}
            </MvText>

            {/* Horários */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <MvText variant="body4" color="secondary" style={{ marginBottom: 4 }}>Início</MvText>
                <MvInput
                  placeholder="08:00"
                  value={startTime}
                  onChangeText={setStartTime}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ flex: 1 }}>
                <MvText variant="body4" color="secondary" style={{ marginBottom: 4 }}>Fim</MvText>
                <MvInput
                  placeholder="09:00"
                  value={endTime}
                  onChangeText={setEndTime}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>

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
                backgroundColor: applyToMoreDays ? "rgba(34,197,94,0.07)" : theme.inputBg,
                marginBottom: applyToMoreDays ? 10 : 16,
              }}
            >
              <MvText variant="body4" style={{ color: theme.text1 }}>
                Aplicar também em outros dias
              </MvText>
              <MvToggle value={applyToMoreDays} onValueChange={(v) => { setApplyToMoreDays(v); setExtraDays(new Set()); }} />
            </TouchableOpacity>

            {/* Seleção de dias extras */}
            {applyToMoreDays ? (
              <View style={{ marginBottom: 16 }}>
                <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>
                  Selecione os dias adicionais:
                </MvText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {WEEKDAYS.filter((d) => d.id !== selectedDay).map((day) => {
                    const selected = extraDays.has(day.id);
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
                          borderColor: selected ? "#22C55E" : theme.border,
                          backgroundColor: selected ? "rgba(34,197,94,0.13)" : theme.inputBg,
                        }}
                      >
                        <MvText
                          variant="body4"
                          style={{
                            color: selected ? theme.textGreen : theme.text2,
                            fontWeight: selected ? "700" : "400",
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
          </MvCard>
        ) : (
          <MvButton
            variant="outline"
            label={`+ Adicionar horário para ${selectedDayFull.toLowerCase()}`}
            onPress={() => setShowAddForm(true)}
          />
        )}
      </ScrollView>
    </View>
  );
}
