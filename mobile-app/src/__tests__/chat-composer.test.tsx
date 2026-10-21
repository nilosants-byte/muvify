import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ChatComposer } from "../screens/client/ClientChatListScreen";
import { ProfessionalChatComposer } from "../screens/professional/ProfessionalChatListScreen";
import { darkTheme } from "../theme/MvColors";

// Frente 11 (engenharia mobile), Lote 7: o composer (campo de texto + botão
// de enviar) foi extraído pra um componente próprio com estado local —
// antes, inputText vivia no mesmo componente que a lista de mensagens, e
// cada tecla digitada re-renderizava a tela inteira (recriando renderItem e
// redesenhando todas as bolhas visíveis do FlatList). Estes testes cobrem o
// comportamento do composer isoladamente, sem montar a tela de chat inteira
// (que depende de socket, useAuthQuery, useAppState etc.).

describe("Frente 11, Lote 7 — ChatComposer (cliente)", () => {
  it("envia o texto (aparado) e limpa o campo em caso de sucesso", async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Escreva para seu personal...");
    fireEvent.changeText(input, "  Olá, tudo bem?  ");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Olá, tudo bem?"));
    await waitFor(() => expect(input.props.value).toBe(""));
  });

  // Teste manual C9.1 (21/10/2026): o campo não trava mais esperando o
  // servidor — a falha vira uma bolha "Não enviada. Toque para tentar de
  // novo" na conversa (ver utils/chatOptimistic.ts), não texto devolvido.
  it("continua editável logo depois de enviar, pra mandar a próxima", () => {
    const onSend = jest.fn();
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Escreva para seu personal...");
    fireEvent.changeText(input, "primeira");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));
    fireEvent.changeText(ui.getByPlaceholderText("Escreva para seu personal..."), "segunda");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    expect(onSend.mock.calls).toEqual([["primeira"], ["segunda"]]);
    expect(ui.getByPlaceholderText("Escreva para seu personal...").props.editable).not.toBe(false);
  });

  it("não envia texto vazio nem só com espaços", () => {
    const onSend = jest.fn();
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Escreva para seu personal...");
    fireEvent.changeText(input, "   ");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("digitar não chama onSend — só o toque no botão de enviar dispara o envio", () => {
    const onSend = jest.fn();
    const ui = render(<ChatComposer onSend={onSend} theme={darkTheme} />);

    fireEvent.changeText(ui.getByPlaceholderText("Escreva para seu personal..."), "abc");
    fireEvent.changeText(ui.getByPlaceholderText("Escreva para seu personal..."), "abcdef");

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("Frente 11, Lote 7 — ProfessionalChatComposer", () => {
  it("envia o texto (aparado) e limpa o campo em caso de sucesso", async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    const ui = render(<ProfessionalChatComposer onSend={onSend} theme={darkTheme} />);

    const input = ui.getByPlaceholderText("Mensagem para o aluno...");
    fireEvent.changeText(input, "  Como foi o treino?  ");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Como foi o treino?"));
    await waitFor(() => expect(input.props.value).toBe(""));
  });

  it("continua editável logo depois de enviar, pra mandar a próxima", () => {
    const onSend = jest.fn();
    const ui = render(<ProfessionalChatComposer onSend={onSend} theme={darkTheme} />);

    fireEvent.changeText(ui.getByPlaceholderText("Mensagem para o aluno..."), "primeira");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));
    fireEvent.changeText(ui.getByPlaceholderText("Mensagem para o aluno..."), "segunda");
    fireEvent.press(ui.getByLabelText("Enviar mensagem"));

    expect(onSend.mock.calls).toEqual([["primeira"], ["segunda"]]);
    expect(ui.getByPlaceholderText("Mensagem para o aluno...").props.editable).not.toBe(false);
  });
});
