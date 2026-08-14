/**
 * Frente 15 (segunda camada, acessibilidade), Lote 1: MvInput nunca conectava
 * o `label` visual ao accessibilityLabel do campo — o leitor de tela só
 * anunciava o placeholder (quando vazio) ou nada. Usado em 126 pontos do
 * app (login, cadastro, anamnese, edição de perfil...). Fallback automático
 * pro `label` quando o chamador não passa accessibilityLabel explícito.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { MvInput } from "../components/mv/MvInput";

describe("Frente 15, Lote 1 — MvInput expõe accessibilityLabel pro leitor de tela", () => {
  it("usa o `label` visual como accessibilityLabel quando nenhum é passado explicitamente", () => {
    const { getByLabelText } = render(<MvInput label="Nome completo" value="" onChangeText={() => {}} />);
    expect(getByLabelText("Nome completo")).toBeTruthy();
  });

  it("accessibilityLabel explícito tem prioridade sobre o `label` visual", () => {
    const { getByLabelText, queryByLabelText } = render(
      <MvInput label="Senha atual" accessibilityLabel="Campo de senha atual, obrigatório" value="" onChangeText={() => {}} />
    );
    expect(getByLabelText("Campo de senha atual, obrigatório")).toBeTruthy();
    expect(queryByLabelText("Senha atual")).toBeNull();
  });

  it("campo sem `label` visual (só placeholder) permanece sem accessibilityLabel quando nenhum é passado — chamador precisa fornecer explicitamente", () => {
    const { getByPlaceholderText } = render(
      <MvInput placeholder="seu@email.com" value="" onChangeText={() => {}} />
    );
    const input = getByPlaceholderText("seu@email.com");
    expect(input.props.accessibilityLabel).toBeUndefined();
  });
});
