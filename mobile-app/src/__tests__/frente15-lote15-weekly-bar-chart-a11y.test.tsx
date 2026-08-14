/**
 * Frente 15 (segunda camada, acessibilidade), Lote 15: WeeklyBarChart
 * renderizava barras puramente visuais (Views), sem nenhuma leitura por
 * voz da receita de cada dia — só o rótulo do dia (texto) tinha leitura.
 *
 * Nota: durante a implementação, confirmado que WeeklyBarChart não é
 * importado/usado em nenhuma tela hoje (só AnimatedBar, seu bloco de
 * construção, é usado em PayoutStatusScreen para outro fim) — corrigido
 * mesmo assim por ser barato e a função já estar pronta pra uso futuro.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { WeeklyBarChart } from "../components/professional/HomeWidgets";

describe("Frente 15, Lote 15 — WeeklyBarChart expõe receita por dia ao leitor de tela", () => {
  it("cada dia vira um único nó acessível com o valor resumido", () => {
    const { getByLabelText } = render(
      <WeeklyBarChart
        data={[
          { label: "Seg", revenue: 150, isToday: false },
          { label: "Ter", revenue: 320.5, isToday: true },
        ]}
        primaryColor="#24E66D"
        barBg="#0D1F14"
      />
    );

    expect(getByLabelText("Seg: R$ 150,00")).toBeTruthy();
    expect(getByLabelText("Ter (hoje): R$ 320,50")).toBeTruthy();
  });
});
