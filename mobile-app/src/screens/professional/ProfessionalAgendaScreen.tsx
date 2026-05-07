import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalTabParamList } from "../../navigation/route-types";
import {
  Availability,
  availabilityApi,
  Booking,
  bookingsApi,
  FinancialStudent,
  financialApi,
  manualBlocksApi,
  WeeklyScheduleSlot,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { handleScreenError } from "../shared/api-helpers";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAY_SHORT_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAY_FULL_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAY_ABBR_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];


type Props = BottomTabScreenProps<ProfessionalTabParamList, "ProfessionalAgenda">;
type AgendaTab = "day" | "week" | "month";

type ManualBlock = {
  id: string;
  dateKey: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  label: string;
  location?: string; // local/endereço do compromisso (opcional)
};

const tabs: Array<{ key: AgendaTab; label: string }> = [
  { key: "day", label: "Dia" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
];

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" };
  return { label: "Pendente", variant: "orange" };
}

function startOfDay(input: Date) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function startOfWeek(input: Date) {
  const date = startOfDay(input);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function endOfWeek(input: Date) {
  const start = startOfWeek(input);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return end;
}

function buildMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();
  const cells: Array<Date | null> = [];
  for (let f = 0; f < leadingBlanks; f++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function formatMinutes(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  return `${Math.floor(clamped / 60).toString().padStart(2, "0")}:${(clamped % 60).toString().padStart(2, "0")}`;
}

function generateDaySlots(availabilities: Availability[], weekday: number) {
  const slotSet = new Set<string>();
  availabilities
    .filter((item) => item.isActive && item.weekday === weekday)
    .forEach((item) => {
      const start = parseMinutes(item.startTime);
      const end = parseMinutes(item.endTime);
      if (end <= start) return;
      for (let minute = start; minute < end; minute += 30) slotSet.add(formatMinutes(minute));
    });
  return Array.from(slotSet).sort((a, b) => a.localeCompare(b));
}

function validateTime(value: string) {
  return /^\d{1,2}:\d{2}$/.test(value.trim());
}

function padTime(value: string): string {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return value.trim();
  return `${parts[0].padStart(2, "0")}:${parts[1]}`;
}

export function ProfessionalAgendaScreen({ navigation }: Props) {
  const { runWithAuth, showToast, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<AgendaTab>("day");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [manualBlocks, setManualBlocks] = useState<ManualBlock[]>([]);
  const [offAppStudents, setOffAppStudents] = useState<FinancialStudent[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [loading, setLoading] = useState(true);
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [blockStart, setBlockStart] = useState("08:00");
  const [blockEnd, setBlockEnd] = useState("09:00");
  const [blockLabel, setBlockLabel] = useState("");
  const [blockLocation, setBlockLocation] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const [availStart, setAvailStart] = useState("08:00");
  const [availEnd, setAvailEnd] = useState("09:00");
  const [availExtraDays, setAvailExtraDays] = useState<Set<number>>(new Set());
  const [availAddSaving, setAvailAddSaving] = useState(false);
  const [deletingAvailId, setDeletingAvailId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [bookingsPayload, availabilitiesPayload, blocksPayload, studentsPayload] = await Promise.all([
        runWithAuth((token) => bookingsApi.me(token)),
        runWithAuth((token) => availabilityApi.me(token)),
        runWithAuth((token) => manualBlocksApi.list(token)),
        runWithAuth((token) => financialApi.listStudents(token)),
      ]);
      const mine = bookingsPayload
        .filter((item) => item.provider?.user?.id === user?.id)
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      setBookings(mine);
      setAvailabilities(availabilitiesPayload);
      setManualBlocks(
        blocksPayload.map((b) => ({
          id: b.id,
          dateKey: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          label: b.label,
          location: b.location ?? undefined,
        }))
      );
      setOffAppStudents(studentsPayload.filter((s) => s.isActive && (s.type === "PRESENTIAL" || s.type === "BOTH") && Array.isArray(s.weeklySchedule) && (s.weeklySchedule as WeeklyScheduleSlot[]).length > 0));
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar agenda.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Bookings visíveis conforme a aba selecionada
  const visibleBookings = useMemo(() => {
    if (activeTab === "day") {
      return bookings.filter((item) => isSameDay(new Date(item.scheduledAt), selectedDate));
    }
    if (activeTab === "week") {
      const from = startOfWeek(selectedDate);
      const to = endOfWeek(selectedDate);
      return bookings.filter((item) => {
        const d = new Date(item.scheduledAt);
        return d >= from && d < to;
      });
    }
    return bookings.filter((item) => {
      const d = new Date(item.scheduledAt);
      return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth();
    });
  }, [activeTab, bookings, selectedDate]);

  // Slots do dia selecionado
  const allDaySlots = useMemo(
    () => generateDaySlots(availabilities, selectedDate.getDay()),
    [availabilities, selectedDate]
  );

  const occupiedSlotKeys = useMemo(() => {
    const taken = new Set<string>();
    bookings.forEach((item) => {
      if (item.status !== "PENDING" && item.status !== "CONFIRMED") return;
      const d = new Date(item.scheduledAt);
      if (!isSameDay(d, selectedDate)) return;
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      taken.add(`${hh}:${mm}`);
    });
    return taken;
  }, [bookings, selectedDate]);

  const selectedDateKey = useMemo(() => toDateKey(selectedDate), [selectedDate]);

  const todayBlockedKeys = useMemo(() => {
    const todayBlocks = manualBlocks.filter((b) => b.dateKey === selectedDateKey);
    if (todayBlocks.length === 0) return new Set<string>();
    const blocked = new Set<string>();
    // Check each availability slot: if it falls inside any manual block range, mark as blocked.
    // This correctly handles blocks at arbitrary times (e.g., 08:20–09:20) even when
    // availability slots are aligned differently (e.g., 08:00, 08:30, 09:00…).
    allDaySlots.forEach((slot) => {
      const slotMin = parseMinutes(slot);
      if (todayBlocks.some((b) => slotMin >= parseMinutes(b.startTime) && slotMin < parseMinutes(b.endTime))) {
        blocked.add(slot);
      }
    });
    return blocked;
  }, [manualBlocks, selectedDateKey, allDaySlots]);

  const freeSlots = useMemo(
    () => allDaySlots.filter((s) => !occupiedSlotKeys.has(s) && !todayBlockedKeys.has(s)),
    [allDaySlots, occupiedSlotKeys, todayBlockedKeys]
  );

  // Dias com agendamentos para o calendário
  const daysWithBookings = useMemo(() => {
    const keys = new Set<string>();
    bookings.forEach((item) => {
      if (item.status !== "CANCELLED") keys.add(toDateKey(new Date(item.scheduledAt)));
    });
    return keys;
  }, [bookings]);

  // Dias com bloqueios manuais (para mostrar indicador laranja no calendário)
  const daysWithBlocks = useMemo(() => {
    const keys = new Set<string>();
    manualBlocks.forEach((b) => keys.add(b.dateKey));
    return keys;
  }, [manualBlocks]);

  // Aulas de alunos fora do app no dia selecionado (por horário recorrente semanal)
  const offAppClassesForDay = useMemo(() => {
    const dayOfWeek = selectedDate.getDay();
    const classes: Array<{ studentName: string; startTime: string; endTime: string; location?: string }> = [];
    offAppStudents.forEach((student) => {
      const schedule = (student.weeklySchedule ?? []) as WeeklyScheduleSlot[];
      schedule.forEach((slot) => {
        if (slot.dayOfWeek === dayOfWeek) {
          classes.push({ studentName: student.name, startTime: slot.startTime, endTime: slot.endTime, location: student.location ?? undefined });
        }
      });
    });
    return classes.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [offAppStudents, selectedDate]);

  const calendarCells = useMemo(
    () => buildMonthGrid(calendarCursor.year, calendarCursor.month),
    [calendarCursor]
  );

  const goToStack = (screen: string, params?: object) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen, params);
  };

  async function addManualBlock() {
    if (!validateTime(blockStart)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    if (!validateTime(blockEnd)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    const paddedStart = padTime(blockStart);
    const paddedEnd = padTime(blockEnd);
    if (paddedStart >= paddedEnd) { showToast("Início deve ser menor que o fim.", "error"); return; }

    try {
      setSavingBlock(true);
      const created = await runWithAuth((token) =>
        manualBlocksApi.create(token, {
          date: selectedDateKey,
          startTime: paddedStart,
          endTime: paddedEnd,
          label: blockLabel.trim() || "Bloqueado",
          location: blockLocation.trim() || undefined,
        })
      );
      setManualBlocks((current) => [
        ...current,
        {
          id: created.id,
          dateKey: created.date,
          startTime: created.startTime,
          endTime: created.endTime,
          label: created.label,
          location: created.location ?? undefined,
        },
      ]);
      showToast("Horário bloqueado.", "success");
      setBlockModalVisible(false);
      setBlockStart("08:00");
      setBlockEnd("09:00");
      setBlockLabel("");
      setBlockLocation("");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível criar bloqueio.", navigation });
    } finally {
      setSavingBlock(false);
    }
  }

  async function removeManualBlock(id: string) {
    Alert.alert("Remover bloqueio", "Deseja remover este bloqueio de horário?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover", style: "destructive",
        onPress: async () => {
          try {
            await runWithAuth((token) => manualBlocksApi.delete(token, id));
            setManualBlocks((current) => current.filter((b) => b.id !== id));
            showToast("Bloqueio removido.", "success");
          } catch (error) {
            handleScreenError({ error, showToast, fallbackMessage: "Não foi possível remover bloqueio.", navigation });
          }
        },
      },
    ]);
  }

  const todayManualBlocks = useMemo(
    () => manualBlocks.filter((b) => b.dateKey === selectedDateKey),
    [manualBlocks, selectedDateKey]
  );

  const selectedWeekday = useMemo(() => selectedDate.getDay(), [selectedDate]);

  // ── Timeline unificada do dia: bookings + slots livres + bloqueios em ordem cronológica ──
  type TimelineItem =
    | { kind: "booking"; time: string; booking: Booking }
    | { kind: "free"; time: string }
    | { kind: "blocked"; time: string; block: ManualBlock };

  const dayTimeline = useMemo<TimelineItem[]>(() => {
    if (activeTab !== "day") return [];
    const items: TimelineItem[] = [];
    allDaySlots.forEach((slot) => {
      const isOccupied = occupiedSlotKeys.has(slot);
      const isBlocked = todayBlockedKeys.has(slot);
      if (isOccupied) {
        const booking = visibleBookings.find((b) => {
          const d = new Date(b.scheduledAt);
          return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` === slot;
        });
        if (booking) items.push({ kind: "booking", time: slot, booking });
      } else if (isBlocked) {
        const block = todayManualBlocks.find((b) => {
          const slotMin = parseMinutes(slot);
          return slotMin >= parseMinutes(b.startTime) && slotMin < parseMinutes(b.endTime);
        });
        if (block) items.push({ kind: "blocked", time: slot, block });
      } else {
        items.push({ kind: "free", time: slot });
      }
    });
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [activeTab, allDaySlots, occupiedSlotKeys, todayBlockedKeys, visibleBookings, todayManualBlocks]);

  const dayAvailabilities = useMemo(
    () => availabilities
      .filter((a) => a.weekday === selectedWeekday && a.isActive)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [availabilities, selectedWeekday]
  );

  function toggleAvailExtraDay(dayId: number) {
    setAvailExtraDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId); else next.add(dayId);
      return next;
    });
  }

  async function addAvailSlot() {
    if (!validateTime(availStart)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    if (!validateTime(availEnd)) { showToast("Formato inválido. Use HH:MM.", "error"); return; }
    const ps = padTime(availStart);
    const pe = padTime(availEnd);
    if (ps >= pe) { showToast("Início deve ser menor que o fim.", "error"); return; }
    const allDays = [selectedWeekday, ...Array.from(availExtraDays)];
    try {
      setAvailAddSaving(true);
      const results = await Promise.all(
        allDays.map((day) =>
          runWithAuth((token) =>
            availabilityApi.create(token, { weekday: day, startTime: ps, endTime: pe, isActive: true })
          )
        )
      );
      setAvailabilities((prev) => [...prev, ...results]);
      setAvailModalVisible(false);
      setAvailStart("08:00");
      setAvailEnd("09:00");
      setAvailExtraDays(new Set());
      const count = allDays.length;
      showToast(count > 1 ? `Horário adicionado em ${count} dias.` : "Horário adicionado.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao adicionar horário.", navigation });
    } finally {
      setAvailAddSaving(false);
    }
  }

  async function removeAvailSlot(id: string) {
    Alert.alert("Remover horário", "Deseja remover este horário disponível?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover", style: "destructive",
        onPress: async () => {
          try {
            setDeletingAvailId(id);
            await runWithAuth((token) => availabilityApi.delete(token, id));
            setAvailabilities((prev) => prev.filter((a) => a.id !== id));
            showToast("Horário removido.", "success");
          } catch (error) {
            handleScreenError({ error, showToast, fallbackMessage: "Falha ao remover horário.", navigation });
          } finally {
            setDeletingAvailId(null);
          }
        },
      },
    ]);
  }

  const selectedDayLabel = useMemo(() => {
    const weekday = WEEKDAY_FULL_PT[selectedDate.getDay()];
    const day = selectedDate.getDate();
    const month = MONTHS_FULL_PT[selectedDate.getMonth()].toLowerCase();
    return `${weekday}, ${day} de ${month}`;
  }, [selectedDate]);

  return (
    <>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 10 : 0}
      >
        <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.agenda">
          <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

        {/* Header */}
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity
            onPress={() => navigation.navigate("ProfessionalHome")}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text2} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <MvText variant="semi1">Minha Agenda</MvText>
          </View>
          {loading ? (
            <MvText variant="body4" color="secondary">Atualizando...</MvText>
          ) : (
            <TouchableOpacity
              onPress={() => {
                const today = startOfDay(new Date());
                setSelectedDate(today);
                setCalendarCursor({ year: today.getFullYear(), month: today.getMonth() });
                setActiveTab("day");
              }}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="calendar-outline" size={20} color={theme.text2} />
            </TouchableOpacity>
          )}
        </View>

        {/* Calendário embutido */}
        <View style={{ paddingHorizontal: 16, marginBottom: 6 }}>
          <MvCard style={{ padding: 12 }}>
            {/* Navegação de mês */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <TouchableOpacity
                onPress={() => setCalendarCursor((c) => {
                  const prev = new Date(c.year, c.month - 1, 1);
                  return { year: prev.getFullYear(), month: prev.getMonth() };
                })}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <MvText variant="semi2">‹</MvText>
              </TouchableOpacity>
              <MvText variant="semi2">
                {`${MONTHS_FULL_PT[calendarCursor.month]} ${calendarCursor.year}`}
              </MvText>
              <TouchableOpacity
                onPress={() => setCalendarCursor((c) => {
                  const next = new Date(c.year, c.month + 1, 1);
                  return { year: next.getFullYear(), month: next.getMonth() };
                })}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <MvText variant="semi2">›</MvText>
              </TouchableOpacity>
            </View>

            {/* Cabeçalho dos dias da semana */}
            <View style={{ flexDirection: "row", marginBottom: 2 }}>
              {WEEKDAY_SHORT_PT.map((label, index) => (
                <View key={`wh-${index}`} style={{ width: "14.285%", alignItems: "center", paddingVertical: 2 }}>
                  <MvText variant="body4" color="secondary" style={{ fontSize: 10 }}>{label}</MvText>
                </View>
              ))}
            </View>

            {/* Grid de dias */}
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {calendarCells.map((dateCell, index) => {
                if (!dateCell) {
                  return <View key={`blank-${index}`} style={{ width: "14.285%", paddingVertical: 2 }} />;
                }
                const isSelected = isSameDay(dateCell, selectedDate);
                const isToday = isSameDay(dateCell, new Date());
                const cellKey = toDateKey(dateCell);
                const hasBooking = daysWithBookings.has(cellKey);
                const hasBlock = daysWithBlocks.has(cellKey);
                const isCurrentMonth = dateCell.getMonth() === calendarCursor.month;
                return (
                  <TouchableOpacity
                    key={`${toDateKey(dateCell)}-${index}`}
                    onPress={() => {
                      setSelectedDate(startOfDay(dateCell));
                      setActiveTab("day");
                    }}
                    style={{ width: "14.285%", alignItems: "center", paddingVertical: 2 }}
                  >
                    <View style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isSelected ? "#22C55E" : "transparent",
                      borderWidth: isToday && !isSelected ? 1.5 : 0,
                      borderColor: "#22C55E",
                    }}>
                      <MvText
                        variant="body4"
                        style={{
                          fontSize: 11,
                          fontWeight: isSelected ? "700" : "400",
                          color: !isCurrentMonth
                            ? theme.text3
                            : isSelected
                            ? "#FFFFFF"
                            : isToday
                            ? theme.textGreen
                            : theme.text1,
                        }}
                      >
                        {dateCell.getDate()}
                      </MvText>
                    </View>
                    {/* Indicadores: verde=agendamento, laranja=bloqueio manual */}
                    {(hasBooking || hasBlock) ? (
                      <View style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
                        {hasBooking ? (
                          <View style={{
                            width: 4, height: 4, borderRadius: 2,
                            backgroundColor: isSelected ? "#22C55E" : "rgba(34,197,94,0.50)",
                          }} />
                        ) : null}
                        {hasBlock ? (
                          <View style={{
                            width: 4, height: 4, borderRadius: 2,
                            backgroundColor: "#FF9800",
                          }} />
                        ) : null}
                      </View>
                    ) : <View style={{ height: 5 }} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Botão Hoje */}
            <TouchableOpacity
              onPress={() => {
                const today = startOfDay(new Date());
                setSelectedDate(today);
                setCalendarCursor({ year: today.getFullYear(), month: today.getMonth() });
                setActiveTab("day");
              }}
              style={{
                alignSelf: "flex-end",
                marginTop: 8,
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.30)",
                backgroundColor: "rgba(34,197,94,0.08)",
              }}
            >
              <MvText variant="semi3" style={{ color: theme.textGreen, fontSize: 12 }}>Hoje</MvText>
            </TouchableOpacity>
          </MvCard>
        </View>

        <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 6, marginBottom: 8 }}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: activeTab === tab.key ? "rgba(34,197,94,0.14)" : theme.chipBg,
                borderWidth: 1,
                borderColor: activeTab === tab.key ? "rgba(34,197,94,0.35)" : theme.border,
              }}
            >
              <MvText variant="semi3" style={{ color: activeTab === tab.key ? theme.textGreen : theme.text2 }}>
                {tab.label}
              </MvText>
            </TouchableOpacity>
          ))}
        </View>
        {/* Lista de agendamentos */}
        <FlatList
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 90,
            gap: 8,
          }}
          data={activeTab === "day" ? [] : visibleBookings}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#22C55E" colors={["#22C55E"]} />
          }
          ListHeaderComponent={
            activeTab === "day" ? (
              <View style={{ gap: 10, marginBottom: 4 }}>
                {/* ── Resumo do dia: header + métricas ── */}
                <View>
                  <MvText variant="semi1" style={{ marginBottom: 10 }}>{selectedDayLabel}</MvText>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 2 }}>
                    <View style={{ flex: 1, borderRadius: 14, padding: 12, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border, alignItems: "center" }}>
                      <MvText variant="h3" style={{ color: theme.text1 }}>{visibleBookings.length}</MvText>
                      <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>Compromissos</MvText>
                    </View>
                    <View style={{ flex: 1, borderRadius: 14, padding: 12, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border, alignItems: "center" }}>
                      <MvText variant="h3" style={{ color: theme.textGreen }}>{freeSlots.length}</MvText>
                      <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>Horários livres</MvText>
                    </View>
                    <View style={{ flex: 1, borderRadius: 14, padding: 12, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border, alignItems: "center" }}>
                      <MvText variant="h3" style={{ color: todayManualBlocks.length > 0 ? "#F59E0B" : theme.text3 }}>{todayManualBlocks.length}</MvText>
                      <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>Bloqueios</MvText>
                    </View>
                  </View>
                </View>

                {/* ── TIMELINE UNIFICADA DO DIA ── */}
                {dayTimeline.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    {dayTimeline.map((item, idx) => {
                      if (item.kind === "booking") {
                        const badge = bookingBadge(item.booking.status);
                        const isCompleted = item.booking.status === "COMPLETED" || item.booking.status === "CANCELLED";
                        return (
                          <TouchableOpacity
                            key={`bk-${item.booking.id}`}
                            activeOpacity={0.85}
                            onPress={() => goToStack("BookingDetailProfessional", { bookingId: item.booking.id })}
                          >
                            <View style={{
                              flexDirection: "row", alignItems: "center", gap: 12,
                              borderRadius: 16, borderWidth: 1, borderColor: theme.border,
                              backgroundColor: theme.cardBg,
                              paddingHorizontal: 14, paddingVertical: 13,
                              opacity: isCompleted ? 0.60 : 1,
                            }}>
                              <MvText variant="semi2" style={{ color: theme.textGreen, minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                              <View style={{ flex: 1, gap: 2 }}>
                                <MvText variant="semi2" numberOfLines={1}>{item.booking.client?.name ?? "Cliente"}</MvText>
                                {item.booking.sessionLocation ? (
                                  <MvText variant="body4" color="secondary" numberOfLines={1}>{item.booking.sessionLocation}</MvText>
                                ) : null}
                              </View>
                              <MvBadge label={badge.label} variant={badge.variant} />
                              <Ionicons name="chevron-forward" size={14} color={theme.text3} />
                            </View>
                          </TouchableOpacity>
                        );
                      }
                      if (item.kind === "blocked") {
                        return (
                          <View key={`bl-${idx}`} style={{
                            flexDirection: "row", alignItems: "center", gap: 12,
                            borderRadius: 16, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
                            backgroundColor: "rgba(245,158,11,0.05)",
                            paddingHorizontal: 14, paddingVertical: 13,
                          }}>
                            <MvText variant="semi2" style={{ color: "#F59E0B", minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                            <View style={{ flex: 1, gap: 2 }}>
                              <MvText variant="semi3" style={{ color: "#F59E0B" }}>{item.block.label}</MvText>
                              {item.block.location ? (
                                <MvText variant="body4" color="secondary">{item.block.location}</MvText>
                              ) : null}
                            </View>
                            <MvBadge label="Bloqueado" variant="orange" />
                          </View>
                        );
                      }
                      // free slot
                      return (
                        <View key={`fr-${item.time}`} style={{
                          flexDirection: "row", alignItems: "center", gap: 12,
                          borderRadius: 16, borderWidth: 1, borderColor: theme.border,
                          backgroundColor: theme.cardBg,
                          paddingHorizontal: 14, paddingVertical: 13,
                        }}>
                          <MvText variant="semi2" style={{ color: theme.text3, minWidth: 44, fontSize: 16 }}>{item.time}</MvText>
                          <MvText variant="body4" color="secondary" style={{ flex: 1 }}>Horário livre</MvText>
                          <MvText variant="semi3" style={{ color: theme.textGreen }}>+ Agendar</MvText>
                        </View>
                      );
                    })}
                  </View>
                ) : allDaySlots.length === 0 ? (
                  <View style={{
                    borderRadius: 16, borderWidth: 1, borderColor: theme.border,
                    backgroundColor: theme.cardBg, padding: 16,
                  }}>
                    <MvText variant="body4" color="secondary">
                      Nenhum horário configurado para este dia. Toque em "Adicionar horário" abaixo.
                    </MvText>
                  </View>
                ) : null}

                {/* Gerenciamento de disponibilidade para o dia da semana */}
                <MvCard>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: dayAvailabilities.length > 0 ? 10 : 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="time-outline" size={15} color={theme.textGreen} />
                      <MvText variant="semi3">Horários disponíveis — {WEEKDAY_FULL_PT[selectedWeekday]}</MvText>
                    </View>
                    <TouchableOpacity
                      onPress={() => { setAvailModalVisible(true); setAvailStart("08:00"); setAvailEnd("09:00"); setAvailExtraDays(new Set()); }}
                      hitSlop={8}
                      style={{
                        width: 28, height: 28, borderRadius: 14,
                        alignItems: "center", justifyContent: "center",
                        borderWidth: 1,
                        borderColor: "rgba(34,197,94,0.30)",
                        backgroundColor: "rgba(34,197,94,0.10)",
                      }}
                    >
                      <Ionicons name="add" size={15} color="#22C55E" />
                    </TouchableOpacity>
                  </View>

                  {dayAvailabilities.length === 0 ? (
                    <MvText variant="body4" color="secondary">
                      Nenhum horário configurado para este dia. Toque em + para adicionar.
                    </MvText>
                  ) : null}

                  {dayAvailabilities.map((slot) => (
                    <View
                      key={slot.id}
                      style={{
                        flexDirection: "row", alignItems: "center",
                        paddingVertical: 10, paddingHorizontal: 12,
                        borderRadius: 12, marginBottom: 6,
                        borderWidth: 1, borderColor: "rgba(34,197,94,0.22)",
                        backgroundColor: "rgba(34,197,94,0.06)",
                      }}
                    >
                      <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#22C55E", marginRight: 10 }} />
                      <Ionicons name="time-outline" size={14} color={theme.textGreen} />
                      <MvText variant="semi3" style={{ flex: 1, marginLeft: 6 }}>
                        {slot.startTime} – {slot.endTime}
                      </MvText>
                      <TouchableOpacity
                        onPress={() => void removeAvailSlot(slot.id)}
                        disabled={deletingAvailId === slot.id}
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={15} color={deletingAvailId === slot.id ? theme.text3 : "#f44336"} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </MvCard>

                {/* Bloqueios manuais do dia */}
                {todayManualBlocks.length > 0 ? (
                  <MvCard>
                    <MvText variant="semi3" style={{ marginBottom: 8 }}>Compromissos bloqueados</MvText>
                    <View style={{ gap: 8 }}>
                      {todayManualBlocks.map((block) => (
                        <View key={block.id} style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: 10,
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: "rgba(255,152,0,0.30)",
                          backgroundColor: "rgba(255,152,0,0.06)",
                        }}>
                          {/* Faixa de cor lateral indicando bloqueio */}
                          <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#FF9800", marginRight: 2 }} />
                          <Ionicons name="lock-closed-outline" size={16} color="#FF9800" style={{ marginTop: 2 }} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <MvText variant="semi3">{block.label}</MvText>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="time-outline" size={12} color={theme.text3} />
                              <MvText variant="body4" color="secondary">{block.startTime} – {block.endTime}</MvText>
                            </View>
                            {block.location ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Ionicons name="location-outline" size={12} color={theme.text3} />
                                <MvText variant="body4" color="secondary">{block.location}</MvText>
                              </View>
                            ) : null}
                            <MvText variant="body4" style={{ color: "#FF9800", fontSize: 10, marginTop: 2 }}>
                              Horário indisponível para novos agendamentos
                            </MvText>
                          </View>
                          <TouchableOpacity onPress={() => void removeManualBlock(block.id)} hitSlop={8}>
                            <Ionicons name="trash-outline" size={16} color="#f44336" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </MvCard>
                ) : null}

                {/* Aulas de alunos externos (fora do app) */}
                {offAppClassesForDay.length > 0 ? (
                  <MvCard>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <Ionicons name="people-outline" size={16} color="#3B82F6" />
                      <MvText variant="semi3">Aulas externas (fora do app)</MvText>
                    </View>
                    <View style={{ gap: 8 }}>
                      {offAppClassesForDay.map((cls, idx) => (
                        <View
                          key={`offapp-${idx}`}
                          style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: 10,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: "rgba(59,130,246,0.25)",
                            backgroundColor: "rgba(59,130,246,0.06)",
                          }}
                        >
                          <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#3B82F6", marginRight: 2 }} />
                          <Ionicons name="person-outline" size={16} color="#3B82F6" style={{ marginTop: 2 }} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <MvText variant="semi3">{cls.studentName}</MvText>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="time-outline" size={12} color={theme.text3} />
                              <MvText variant="body4" color="secondary">{cls.startTime} – {cls.endTime}</MvText>
                            </View>
                            {cls.location ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Ionicons name="location-outline" size={12} color={theme.text3} />
                                <MvText variant="body4" color="secondary" numberOfLines={1}>{cls.location}</MvText>
                              </View>
                            ) : null}
                            <MvText variant="body4" style={{ color: "#3B82F6", fontSize: 10, marginTop: 2 }}>
                              Aluno externo — cadastrado no Controle Financeiro
                            </MvText>
                          </View>
                        </View>
                      ))}
                    </View>
                  </MvCard>
                ) : null}

                {/* Botão bloquear horário */}
                <TouchableOpacity
                  onPress={() => setBlockModalVisible(true)}
                  style={{
                    paddingVertical: 13,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: "transparent",
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Ionicons name="lock-closed-outline" size={16} color={theme.text2} />
                  <MvText variant="semi3" color="secondary">Bloquear horário neste dia</MvText>
                </TouchableOpacity>

{/* bookings já exibidos na timeline acima no modo dia */}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const badge = bookingBadge(item.status);
            const d = new Date(item.scheduledAt);
            const isCompleted = item.status === "COMPLETED" || item.status === "CANCELLED";
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => goToStack("BookingDetailProfessional", { bookingId: item.id })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: theme.cardBg,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  opacity: isCompleted ? 0.60 : 1,
                }}
              >
                {/* Horário no lado esquerdo — destaque visual */}
                <View style={{
                  minWidth: 44,
                  alignItems: "center",
                  flexShrink: 0,
                }}>
                  <MvText variant="h3" style={{ color: theme.textGreen, fontSize: 17 }}>
                    {d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </MvText>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <MvText variant="semi2" numberOfLines={1}>{item.client?.name ?? "Cliente"}</MvText>
                  {item.sessionLocation ? (
                    <MvText variant="body4" color="secondary" numberOfLines={1}>{item.sessionLocation}</MvText>
                  ) : item.notes ? (
                    <MvText variant="body4" color="secondary" numberOfLines={1}>{item.notes}</MvText>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <MvBadge label={badge.label} variant={badge.variant} />
                  <Ionicons name="chevron-forward" size={14} color={theme.text3} />
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            !loading ? (
              <View style={{ paddingVertical: 32, alignItems: "center", gap: 10 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.chipBg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="calendar-outline" size={26} color={theme.textGreen} />
                </View>
                <MvText variant="semi3" color="secondary">Nenhum compromisso para este dia</MvText>
                <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                  Adicione horários disponíveis para receber agendamentos.
                </MvText>
                <TouchableOpacity
                  onPress={() => setAvailModalVisible(true)}
                  style={{ marginTop: 4, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: theme.textGreen }}
                >
                  <MvText variant="semi3" style={{ color: "#fff" }}>+ Adicionar horário</MvText>
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListFooterComponent={
            <TouchableOpacity
              onPress={() => { setAvailModalVisible(true); setAvailStart("08:00"); setAvailEnd("09:00"); setAvailExtraDays(new Set()); }}
              style={{
                marginTop: 12,
                paddingVertical: 15,
                borderRadius: 14,
                backgroundColor: theme.textGreen,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <MvText variant="semi2" style={{ color: "#fff" }}>Adicionar horário</MvText>
            </TouchableOpacity>
          }
          showsVerticalScrollIndicator={false}
          pinchGestureEnabled
          maximumZoomScale={3}
        />
          {!keyboardVisible ? (
            <ProfessionalBottomNav
              activeKey="agenda"
              onPress={(key) => {
                if (key === "home") {
                  navigation.navigate("ProfessionalHome");
                  return;
                }
                if (key === "agenda") return;
                if (key === "alunos") {
                  goToStack("ProfessionalStudents");
                  return;
                }
                if (key === "conversas") {
                  goToStack("ProfessionalChatList");
                  return;
                }
                if (key === "financeiro") {
                  goToStack("PayoutStatus");
                  return;
                }
              }}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* Modal de bloqueio manual */}
      <Modal
        animationType="slide"
        transparent
        visible={blockModalVisible}
        onRequestClose={() => setBlockModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 12 : 16}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
            <Pressable
              style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
              onPress={() => setBlockModalVisible(false)}
            />
            <View style={{
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              backgroundColor: theme.cardBg,
              borderWidth: 1,
              borderColor: theme.border,
              paddingBottom: insets.bottom + 16,
            }}>
              <ScrollView
                automaticallyAdjustKeyboardInsets={true}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 24 }}
              >
                <MvText variant="semi1">Bloquear horário</MvText>
                <MvText variant="body4" color="secondary">{selectedDayLabel}</MvText>

                <MvInput
                  placeholder="Compromisso (ex: Reunião com cliente, Médico…)"
                  value={blockLabel}
                  onChangeText={setBlockLabel}
                  returnKeyType="next"
                />
                <MvInput
                  placeholder="Local (ex: Academia Bifit, Rua X, 123 — opcional)"
                  value={blockLocation}
                  onChangeText={setBlockLocation}
                  returnKeyType="next"
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 4 }}>Início</MvText>
                    <MvInput
                      placeholder="08:00"
                      value={blockStart}
                      onChangeText={setBlockStart}
                      keyboardType="numbers-and-punctuation"
                      returnKeyType="next"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 4 }}>Fim</MvText>
                    <MvInput
                      placeholder="09:00"
                      value={blockEnd}
                      onChangeText={setBlockEnd}
                      keyboardType="numbers-and-punctuation"
                      returnKeyType="done"
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <MvButton variant="outline" label="Cancelar" onPress={() => { setBlockModalVisible(false); setBlockLocation(""); }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <MvButton label="Bloquear" loading={savingBlock} onPress={() => void addManualBlock()} />
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal de adicionar horário disponível */}
      <Modal
        animationType="slide"
        transparent
        visible={availModalVisible}
        onRequestClose={() => setAvailModalVisible(false)}
      >
        {/* Toque fora da folha fecha o modal — sem sobreposição visual */}
        <Pressable
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          onPress={() => { setAvailModalVisible(false); setAvailExtraDays(new Set()); }}
        />

        {/* KAV envolve APENAS a folha */}
        <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: theme.cardBg,
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: theme.border,
              overflow: "hidden",
            }}>
              {/* Handle */}
              <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 2 }}>
                <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
              </View>

              <ScrollView
                automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 22,
                  paddingTop: 14,
                  paddingBottom: insets.bottom + 28,
                  gap: 18,
                }}
              >
                {/* Título */}
                <View>
                  <MvText variant="semi1" style={{ fontSize: 17 }}>Novo horário disponível</MvText>
                  <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
                    {WEEKDAY_FULL_PT[selectedWeekday]}
                  </MvText>
                </View>

                {/* Campos de hora */}
                <View style={{
                  flexDirection: "row",
                  gap: 12,
                  backgroundColor: theme.inputBg,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.border,
                  padding: 14,
                }}>
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Início
                    </MvText>
                    <MvInput
                      placeholder="08:00"
                      value={availStart}
                      onChangeText={setAvailStart}
                      keyboardType="numbers-and-punctuation"
                      returnKeyType="next"
                    />
                  </View>
                  <View style={{ width: 1, backgroundColor: theme.border, marginVertical: 4 }} />
                  <View style={{ flex: 1 }}>
                    <MvText variant="body4" color="secondary" style={{ marginBottom: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Fim
                    </MvText>
                    <MvInput
                      placeholder="09:00"
                      value={availEnd}
                      onChangeText={setAvailEnd}
                      keyboardType="numbers-and-punctuation"
                      returnKeyType="done"
                    />
                  </View>
                </View>

                {/* Dias adicionais */}
                <View>
                  <MvText variant="body4" color="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
                    Replicar também em:
                  </MvText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {WEEKDAY_ABBR_PT.map((label, dayId) => {
                      if (dayId === selectedWeekday) return null;
                      const isSelected = availExtraDays.has(dayId);
                      return (
                        <TouchableOpacity
                          key={dayId}
                          onPress={() => toggleAvailExtraDay(dayId)}
                          activeOpacity={0.75}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 7,
                            borderRadius: 20,
                            borderWidth: 1,
                            borderColor: isSelected ? theme.textGreen : theme.border,
                            backgroundColor: isSelected ? "rgba(34,197,94,0.12)" : theme.chipBg,
                          }}
                        >
                          <MvText variant="semi3" style={{
                            color: isSelected ? theme.textGreen : theme.text2,
                            fontSize: 13,
                          }}>
                            {label}
                          </MvText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Botões */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => { setAvailModalVisible(false); setAvailExtraDays(new Set()); }}
                    style={{
                      flex: 1,
                      paddingVertical: 13,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.border,
                      alignItems: "center",
                    }}
                  >
                    <MvText variant="semi3" color="secondary">Cancelar</MvText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void addAvailSlot()}
                    disabled={availAddSaving}
                    activeOpacity={0.85}
                    style={{
                      flex: 2,
                      paddingVertical: 13,
                      borderRadius: 12,
                      backgroundColor: availAddSaving ? "rgba(34,197,94,0.5)" : "#22C55E",
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 8,
                    }}
                  >
                    {availAddSaving ? (
                      <Ionicons name="sync-outline" size={15} color="#fff" />
                    ) : (
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    )}
                    <MvText variant="semi3" style={{ color: "#fff" }}>
                      {availExtraDays.size > 0 ? `Salvar em ${availExtraDays.size + 1} dias` : "Salvar horário"}
                    </MvText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}




