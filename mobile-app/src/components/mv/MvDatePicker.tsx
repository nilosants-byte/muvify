import React, { useState } from "react";
import { Modal, Platform, TouchableOpacity, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton } from "./MvButton";
import { MvText } from "./MvText";

export function MvDatePicker({ value, onChange }: {
  value: Date;
  onChange: (date: Date) => void;
}) {
  const { theme } = useMvTheme();
  const isDark = theme.mode === "dark";
  const [show, setShow] = useState(false);
  const [tempDate, setTempDate] = useState(value);

  const formatted = value.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  function handleChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") {
      setShow(false);
      if (_event.type === "set" && selected) onChange(selected);
    } else {
      if (selected) setTempDate(selected);
    }
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => { setTempDate(value); setShow(true); }}
        activeOpacity={0.7}
        style={{
          flexDirection: "row", alignItems: "center", gap: 8,
          borderWidth: 1, borderColor: theme.border, borderRadius: 10,
          backgroundColor: theme.inputBg, paddingHorizontal: 12, paddingVertical: 12,
        }}
      >
        <Ionicons name="calendar-outline" size={16} color={theme.text3} />
        <MvText variant="body4" style={{ flex: 1, color: theme.text2, fontSize: 14 }}>{formatted}</MvText>
        <Ionicons name="chevron-down" size={14} color={theme.text3} />
      </TouchableOpacity>

      {Platform.OS === "android" && show && (
        <DateTimePicker
          value={value}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      )}

      {Platform.OS === "ios" && (
        <Modal visible={show} transparent animationType="fade">
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
            onPress={() => setShow(false)}
            activeOpacity={1}
          >
            <TouchableOpacity activeOpacity={1}>
              <View style={{
                backgroundColor: isDark ? theme.bgSurface : "#fff",
                borderTopLeftRadius: 20, borderTopRightRadius: 20,
                padding: 16, paddingBottom: 36,
              }}>
                <DateTimePicker
                  value={tempDate}
                  mode="date"
                  display="spinner"
                  onChange={handleChange}
                  locale="pt-BR"
                  style={{ height: 200 }}
                />
                <MvButton label="Confirmar" onPress={() => { onChange(tempDate); setShow(false); }} />
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
}
