export function formatCurrencyBRL(value: number): string {
  if (!Number.isFinite(value)) return "R$ 0,00";
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value);
}
export function formatPhoneBR(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{0,2})/, '($1')
      .replace(/^\((\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{0,4})$/, '$1-$2')
      .trim();
  }
  return digits
    .replace(/^(\d{0,2})/, '($1')
    .replace(/^\((\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{0,4})$/, '$1-$2')
    .trim();
}
const TZ = "America/Sao_Paulo";

export function formatDateTimeLabel(dateIso: string | null | undefined): string {
  if (!dateIso) return "—";
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(date);
}
export function formatDateLabel(dateIso: string | null | undefined): string {
  if (!dateIso) return "—";
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  }).format(date);
}
// Frente 5 (Descoberta, agendamento e agenda), Lote 12: comparações de
// "hoje" espalhadas pelo app usavam o fuso horário local do aparelho —
// um usuário viajando (ou com o fuso do aparelho errado) via um
// agendamento de hoje sumir da seção "hoje" perto da virada do dia.
export function dateKeyInAppTimezone(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}
export function isTodayInAppTimezone(dateIso: string | null | undefined): boolean {
  if (!dateIso) return false;
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return false;
  return dateKeyInAppTimezone(date) === dateKeyInAppTimezone(new Date());
}
export function isCurrentWeekInAppTimezone(dateIso: string | null | undefined): boolean {
  if (!dateIso) return false;
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return false;
  const targetKey = dateKeyInAppTimezone(date);
  const todayKey = dateKeyInAppTimezone(new Date());
  // Ancora em UTC pra fazer aritmetica de calendario sobre a data-chave
  // (ja resolvida no fuso do app) sem reintroduzir o fuso do aparelho.
  const today = new Date(`${todayKey}T00:00:00Z`);
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() - today.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  const startKey = start.toISOString().slice(0, 10);
  const endKey = end.toISOString().slice(0, 10);
  return targetKey >= startKey && targetKey < endKey;
}
export function formatTimeLabel(dateIso: string | null | undefined): string {
  if (!dateIso) return "—";
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(date);
}
export function formatBRDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(date);
}
export function formatBRDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TZ,
  }).format(date);
}
export function formatBRTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(date);
}
export function maskPriceInput(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  const numeric = Number(digits) / 100;
  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
export function maskDateInputBR(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
export function formatRelativeActivityLabel(dateIso: string | null | undefined): string {
  if (!dateIso) return "Sem atividade registrada";
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return "Sem atividade registrada";
  const diffDays = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Última atividade: hoje";
  if (diffDays === 1) return "Última atividade: há 1 dia";
  return `Última atividade: há ${diffDays} dias`;
}
// Frente 10 (segunda camada), Lote 4: sessão criada com o header
// X-Device-Label (app mobile, via Device.deviceName) já chega com um nome
// legível ("iPhone 15 Pro") — mas sessões sem esse header (login web,
// sessões antigas de antes do header existir) guardam o User-Agent técnico
// cru ("Mozilla/5.0 ... AppleWebKit..."), ilegível pro usuário final.
export function friendlyDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Aparelho desconhecido";
  const looksTechnical = /Mozilla\/|okhttp|CFNetwork|Dalvik|Windows NT|Macintosh|X11;|Linux x86/i.test(userAgent);
  if (!looksTechnical) return userAgent;

  let os: string;
  if (/iPhone|iPad|iPod/i.test(userAgent)) os = "iOS";
  else if (/Android/i.test(userAgent)) os = "Android";
  else if (/Windows/i.test(userAgent)) os = "Windows";
  else if (/Macintosh|Mac OS X/i.test(userAgent)) os = "macOS";
  else if (/Linux/i.test(userAgent)) os = "Linux";
  else os = "Sistema desconhecido";

  let client: string;
  if (/OPR\/|Opera/i.test(userAgent)) client = "Opera";
  else if (/Edg\//i.test(userAgent)) client = "Edge";
  else if (/CriOS\//i.test(userAgent) || (/Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent))) client = "Chrome";
  else if (/FxiOS\//i.test(userAgent) || /Firefox\//i.test(userAgent)) client = "Firefox";
  else if (/Safari\//i.test(userAgent) && !/Chrome/i.test(userAgent)) client = "Safari";
  else if (/okhttp/i.test(userAgent)) client = "App";
  else client = "Navegador";

  return `${os} · ${client}`;
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
