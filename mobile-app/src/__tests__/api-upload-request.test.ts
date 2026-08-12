import { ApiError, apiUploadRequest, uploadsApi } from "../services/api/client";

// Frente 11 (engenharia mobile), Lote 2: apiUploadRequest usa XMLHttpRequest
// (não fetch) porque só XHR expõe progresso real de upload em RN. Não existe
// XMLHttpRequest de verdade no ambiente de teste (jest-expo roda em Node),
// então simulamos aqui — mesmo papel que o mock de fetch já cumpre pros
// outros endpoints em api-client-critical.test.ts.
class MockXHR {
  static instances: MockXHR[] = [];

  method = "";
  url = "";
  timeout = 0;
  responseType = "";
  status = 0;
  responseText = "";
  private requestHeaders: Record<string, string> = {};
  private responseHeaders: Record<string, string> = {};
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null
  };
  onload: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentBody: unknown = null;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }

  getRequestHeader(name: string) {
    return this.requestHeaders[name] ?? null;
  }

  setResponseHeader(name: string, value: string) {
    this.responseHeaders[name] = value;
  }

  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }

  send(body: unknown) {
    this.sentBody = body;
  }
}

function lastInstance() {
  const instance = MockXHR.instances[MockXHR.instances.length - 1];
  if (!instance) throw new Error("nenhuma instância de XMLHttpRequest foi criada");
  return instance;
}

describe("Frente 11, Lote 2 — apiUploadRequest (XMLHttpRequest)", () => {
  beforeEach(() => {
    MockXHR.instances = [];
    (globalThis as unknown as { XMLHttpRequest: typeof MockXHR }).XMLHttpRequest = MockXHR;
  });

  it("sem fileSizeBytes: usa o piso de 30s e resolve com o payload JSON em caso de sucesso", async () => {
    const promise = apiUploadRequest<{ url: string }>("/uploads/media", {
      token: "tok",
      formData: new FormData()
    });

    const xhr = lastInstance();
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toContain("/uploads/media");
    expect(xhr.timeout).toBe(30000);
    expect(xhr.getRequestHeader("Authorization")).toBe("Bearer tok");

    xhr.status = 200;
    xhr.setResponseHeader("content-type", "application/json");
    xhr.responseText = JSON.stringify({ url: "https://cdn/file.jpg" });
    xhr.onload?.();

    await expect(promise).resolves.toEqual({ url: "https://cdn/file.jpg" });
  });

  it("timeout cresce proporcionalmente ao tamanho do arquivo, sem cair abaixo do piso de 30s", async () => {
    apiUploadRequest("/uploads/media", { formData: new FormData(), fileSizeBytes: 1024 });
    expect(lastInstance().timeout).toBe(30000);

    const fiftyMb = 50 * 1024 * 1024;
    apiUploadRequest("/uploads/media", { formData: new FormData(), fileSizeBytes: fiftyMb });
    const transferMs = (fiftyMb / 1024 / 150) * 1000;
    const expectedTimeout = Math.ceil(transferMs) + 20000;
    expect(lastInstance().timeout).toBe(expectedTimeout);
    expect(lastInstance().timeout).toBeGreaterThan(30000);
  });

  it("progresso real: onProgress recebe a fração enviada a cada evento do upload", async () => {
    const onProgress = jest.fn();
    const promise = apiUploadRequest("/uploads/media", { formData: new FormData(), onProgress });
    const xhr = lastInstance();

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 });
    // Evento sem total conhecido (upload em chunked/streaming) é ignorado, não quebra.
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 });

    expect(onProgress).toHaveBeenNthCalledWith(1, 0.25);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1);
    expect(onProgress).toHaveBeenCalledTimes(2);

    xhr.status = 200;
    xhr.setResponseHeader("content-type", "application/json");
    xhr.responseText = JSON.stringify({ url: "https://cdn/file.jpg" });
    xhr.onload?.();
    await promise;
  });

  it("erro HTTP: rejeita com ApiError reaproveitando a mesma lógica de mensagem do fetch (429 com Retry-After)", async () => {
    const promise = apiUploadRequest("/uploads/media", { formData: new FormData() });
    const xhr = lastInstance();

    xhr.status = 429;
    xhr.setResponseHeader("content-type", "application/json");
    xhr.setResponseHeader("Retry-After", "45");
    xhr.responseText = JSON.stringify({});
    xhr.onload?.();

    const error = (await promise.catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.message).toContain("45s");
  });

  it("estoura o timeout (ontimeout): rejeita com ApiError de timeout, status 0", async () => {
    const promise = apiUploadRequest("/uploads/media", { formData: new FormData() });
    lastInstance().ontimeout?.();

    const error = (await promise.catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it("falha de rede (onerror): rejeita com ApiError de rede, status 0", async () => {
    const promise = apiUploadRequest("/uploads/media", { formData: new FormData() });
    lastInstance().onerror?.();

    const error = (await promise.catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it("uploadsApi.uploadMedia repassa fileSizeBytes e onProgress pra apiUploadRequest", async () => {
    const onProgress = jest.fn();
    const promise = uploadsApi.uploadMedia(
      "tok",
      { uri: "file://video.mp4", mimeType: "video/mp4", fileName: "video.mp4", fileSizeBytes: 10 * 1024 * 1024 },
      "presentation-videos",
      onProgress
    );

    const xhr = lastInstance();
    expect(xhr.timeout).toBeGreaterThan(30000);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    expect(onProgress).toHaveBeenCalledWith(0.5);

    xhr.status = 200;
    xhr.setResponseHeader("content-type", "application/json");
    xhr.responseText = JSON.stringify({ url: "https://cdn/video.mp4", mimeType: "video/mp4", sizeBytes: 123 });
    xhr.onload?.();
    await promise;
  });
});
