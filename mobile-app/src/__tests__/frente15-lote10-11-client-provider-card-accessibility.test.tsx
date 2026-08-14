/**
 * Frente 15 (segunda camada, acessibilidade):
 * - Lote 10: botão de fechar o bottom sheet de agendamento (só ícone, 30x30)
 *   sem accessibilityLabel.
 * - Lote 11: seletor de dia (bolinha verde/cinza) sem accessibilityRole/
 *   State/Label mencionando disponibilidade — leitor de tela ouvia só
 *   "Seg", "Ter" etc. sem saber se havia vaga.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { ClientProviderCard, ScheduleDay } from "../screens/client/components/ClientProviderCard";

function scheduleDay(overrides: Partial<ScheduleDay>): ScheduleDay {
  return {
    date: "2026-08-17",
    label: "Seg",
    availableSlots: [],
    occupiedSlots: [],
    ...overrides
  };
}

describe("Frente 15, Lotes 10 e 11 — ClientProviderCard expõe fechar e disponibilidade por dia", () => {
  const baseProps = {
    visible: true,
    provider: { id: "provider-1", displayName: "Personal Teste", priceCents: 10000 },
    detailLoading: false,
    specialties: [],
    scheduleLoading: false,
    selectedDay: null,
    selectedDayPayload: null,
    onSelectDay: jest.fn(),
    onClose: jest.fn(),
    onBook: jest.fn(),
    onViewProfile: jest.fn(),
    onChat: jest.fn(),
  };

  it("botão de fechar tem accessibilityLabel", () => {
    const { getByLabelText } = render(<ClientProviderCard {...baseProps} scheduleDays={[]} />);
    expect(getByLabelText("Fechar")).toBeTruthy();
  });

  it("dia com horário disponível anuncia disponibilidade e estado selecionado", () => {
    const { getByLabelText } = render(
      <ClientProviderCard
        {...baseProps}
        selectedDay="2026-08-17"
        scheduleDays={[scheduleDay({ availableSlots: ["09:00", "10:00"] })]}
      />
    );
    const chip = getByLabelText("Seg, com horário disponível");
    expect(chip).toBeTruthy();
    expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it("dia sem horário disponível anuncia a ausência de vaga", () => {
    const { getByLabelText } = render(
      <ClientProviderCard {...baseProps} scheduleDays={[scheduleDay({ availableSlots: [] })]} />
    );
    expect(getByLabelText("Seg, sem horário disponível")).toBeTruthy();
  });
});
