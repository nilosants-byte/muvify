/**
 * Frente 15 (segunda camada, acessibilidade), Lote 5: os itens da bottom
 * nav (cliente e profissional) já tinham accessibilityLabel/State corretos,
 * mas usavam accessibilityRole="button" em vez de "tab"/"tablist" — o
 * leitor de tela não anunciava contexto de navegação por abas.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { MvBottomNav } from "../components/mv/MvBottomNav";
import { ProfessionalBottomNav } from "../components/navigation/ProfessionalBottomNav";

describe("Frente 15, Lote 5 — bottom nav usa semântica de aba", () => {
  it("MvBottomNav: container é tablist e itens são tab", () => {
    const { getByTestId } = render(
      <MvBottomNav
        items={[
          { key: "home", icon: "home-outline", label: "Início" },
          { key: "search", icon: "search-outline", label: "Buscar" },
        ]}
        activeKey="home"
      />
    );
    expect(getByTestId("nav.bottom").props.accessibilityRole).toBe("tablist");
    expect(getByTestId("nav.bottom.home").props.accessibilityRole).toBe("tab");
    expect(getByTestId("nav.bottom.search").props.accessibilityRole).toBe("tab");
  });

  it("ProfessionalBottomNav: container é tablist e itens são tab", () => {
    const { getByTestId } = render(<ProfessionalBottomNav activeKey="home" onPress={() => {}} />);
    expect(getByTestId("nav.bottom.home").props.accessibilityRole).toBe("tab");
    expect(getByTestId("nav.bottom.agenda").props.accessibilityRole).toBe("tab");
  });
});
