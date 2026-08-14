/**
 * Frente 15 (segunda camada, acessibilidade), Lote 2: MvToggle não aceitava
 * accessibilityLabel — o leitor de tela anunciava só "switch, ligado/
 * desligado" sem dizer do quê. Grave em telas com vários toggles seguidos
 * (ex: "Mais" do profissional, 3 toggles em sequência).
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { MvToggle } from "../components/mv/MvToggle";

describe("Frente 15, Lote 2 — MvToggle expõe accessibilityLabel pro leitor de tela", () => {
  it("aplica o accessibilityLabel passado", () => {
    const { getByLabelText } = render(<MvToggle value={true} accessibilityLabel="Notificações" />);
    const toggle = getByLabelText("Notificações");
    expect(toggle).toBeTruthy();
    expect(toggle.props.accessibilityRole).toBe("switch");
    expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  });

  it("continua funcionando sem accessibilityLabel (prop opcional, sem quebrar uso existente)", () => {
    const { getByRole } = render(<MvToggle value={false} />);
    expect(getByRole("switch")).toBeTruthy();
  });
});
