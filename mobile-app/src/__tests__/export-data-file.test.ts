import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { shareBase64FileAsFile, shareExportedDataAsFile } from "../utils/exportDataFile";

// Épico de Frentes, Frente 11, Lote 5: exportMyData mandava o JSON inteiro
// como corpo de uma mensagem de texto (Share.share) - vira mensagem de app
// de mensagens em vez de arquivo. shareExportedDataAsFile passa a gerar um
// arquivo .json de verdade e abrir o share sheet nativo.
const mockFileInstance = {
  exists: false,
  uri: "file:///cache/muvify-meus-dados-123.json",
  delete: jest.fn(),
  create: jest.fn(),
  write: jest.fn()
};

const mockShareFn = jest.fn();

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation(() => mockFileInstance),
  Paths: { cache: "mock-cache-dir" }
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn()
}));

jest.mock("react-native", () => {
  // Não espalhar (`{...actual}`) - isso lê TODAS as propriedades do módulo,
  // incluindo getters lazy (DevMenu, FlatList, etc.) que quebram fora do
  // binário nativo. Share é definido via getter (sem setter) no index.js
  // do react-native, então uma atribuição direta (`actual.Share = ...`)
  // é silenciosamente ignorada - precisa de defineProperty.
  const actual = jest.requireActual("react-native");
  Object.defineProperty(actual, "Share", {
    configurable: true,
    get: () => ({ share: mockShareFn })
  });
  return actual;
});

describe("shareExportedDataAsFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileInstance.exists = false;
  });

  it("quando compartilhamento de arquivo está disponível, escreve o arquivo e abre o share sheet nativo", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);

    await shareExportedDataAsFile({ hello: "world" });

    expect(File).toHaveBeenCalled();
    expect(mockFileInstance.create).toHaveBeenCalledTimes(1);
    expect(mockFileInstance.write).toHaveBeenCalledWith(JSON.stringify({ hello: "world" }, null, 2));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      mockFileInstance.uri,
      expect.objectContaining({ mimeType: "application/json" })
    );
    expect(mockShareFn).not.toHaveBeenCalled();
  });

  it("apaga o arquivo anterior antes de recriar, se já existir", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    mockFileInstance.exists = true;

    await shareExportedDataAsFile({ hello: "world" });

    expect(mockFileInstance.delete).toHaveBeenCalledTimes(1);
    expect(mockFileInstance.create).toHaveBeenCalledTimes(1);
  });

  it("quando compartilhamento de arquivo não está disponível (ex.: web), cai no Share.share com o texto", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await shareExportedDataAsFile({ hello: "world" });

    expect(mockShareFn).toHaveBeenCalledWith(
      expect.objectContaining({ message: JSON.stringify({ hello: "world" }, null, 2) })
    );
    expect(mockFileInstance.write).not.toHaveBeenCalled();
  });
});

// Planilha (.xlsx) vem do servidor em base64 - binário, então grava com
// encoding base64 e NÃO tem fallback em texto corrido (viraria lixo).
describe("shareBase64FileAsFile", () => {
  const options = {
    filename: "muvify-meus-dados-2026-09-28.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: "Meus dados — Muvify"
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFileInstance.exists = false;
  });

  it("grava o conteúdo em base64 e abre o share sheet com o mimeType da planilha", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);

    await shareBase64FileAsFile("UEsDBA==", options);

    expect(mockFileInstance.write).toHaveBeenCalledWith("UEsDBA==", { encoding: "base64" });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      mockFileInstance.uri,
      expect.objectContaining({ mimeType: options.mimeType })
    );
  });

  it("sem compartilhamento de arquivo, falha explicitamente em vez de mandar binário como texto", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await expect(shareBase64FileAsFile("UEsDBA==", options)).rejects.toThrow(/indispon/i);
    expect(mockShareFn).not.toHaveBeenCalled();
    expect(mockFileInstance.write).not.toHaveBeenCalled();
  });
});
