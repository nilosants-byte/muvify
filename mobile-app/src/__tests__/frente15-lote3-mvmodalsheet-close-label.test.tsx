/**
 * Frente 15 (segunda camada, acessibilidade), Lote 3: MvModalSheet (usado em
 * 4 telas financeiras — Controle Financeiro, Alunos, Histórico, Metas) tinha
 * o botão de fechar (X) sem accessibilityLabel — um usuário de leitor de
 * tela não sabia como sair do modal em tela cheia.
 */
import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import { MvModalSheet } from "../components/mv/MvModalSheet";

describe("Frente 15, Lote 3 — MvModalSheet expõe o botão de fechar pro leitor de tela", () => {
  it("botão de fechar tem accessibilityLabel", () => {
    const { getByLabelText } = render(
      <MvModalSheet visible title="Novo lançamento" onClose={() => {}}>
        <Text>conteúdo</Text>
      </MvModalSheet>
    );
    expect(getByLabelText("Fechar")).toBeTruthy();
  });
});
