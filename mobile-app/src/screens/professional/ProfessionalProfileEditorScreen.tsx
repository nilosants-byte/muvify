import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MvVideoPlayer } from "../../components/mv/MvVideoPlayer";
import { ProfessionalTabParamList } from "../../navigation/route-types";
import {
  PROFESSIONAL_SPECIALTIES,
  ProviderFixedLocation,
  providersApi,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { resolveMediaUrl } from "../../utils/media";

type Props = BottomTabScreenProps<ProfessionalTabParamList, "ProfessionalProfileEditor">;

const PHOTO_SIZE = 140;

function parsePriceToCents(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function StepHeader({ step, title, subtitle, locked }: { step: number; title: string; subtitle?: string; locked?: boolean }) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 2 }}>
      <View
        style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: locked ? theme.chipBg : "rgba(34,197,94,0.15)",
          borderWidth: 1.5,
          borderColor: locked ? theme.border : "rgba(34,197,94,0.40)",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <MvText variant="semi2" style={{ color: locked ? theme.text3 : "#22C55E" }}>{step}</MvText>
      </View>
      <View style={{ flex: 1 }}>
        <MvText variant="semi1" style={{ color: locked ? theme.text3 : theme.text1 }}>{title}</MvText>
        {subtitle ? <MvText variant="body4" color="secondary">{subtitle}</MvText> : null}
      </View>
      {locked ? <Ionicons name="lock-closed-outline" size={16} color={theme.text3} /> : null}
    </View>
  );
}

export function ProfessionalProfileEditorScreen({ navigation }: Props) {
  const { runWithAuth, setCurrentUser, syncCurrentUser, showToast, user } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  // Perfil em cache do AppState — usado para pré-popular os campos sem esperar o API call,
  // eliminando o frame "em branco" ao abrir a tela.
  const cachedProfile = user?.providerProfile ?? null;

  // Step 1 fields — inicializados a partir do cache do AppState (exibição imediata)
  const [displayName, setDisplayName] = useState(
    cachedProfile?.displayName ?? user?.name ?? ""
  );
  const [bio, setBio] = useState(cachedProfile?.bio ?? "");
  const [photoUrl, setPhotoUrl] = useState(cachedProfile?.photoUrl ?? "");
  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(
    resolveMediaUrl(cachedProfile?.photoUrl)
  );
  const [presentationVideoUrl, setPresentationVideoUrl] = useState<string | null>(null);
  // Local file:// URI for crash-free preview; base64 data URI only lives in presentationVideoUrl for submission
  const [videoLocalUri, setVideoLocalUri] = useState<string | null>(null);
  const [videoProcessing, setVideoProcessing] = useState(false);
  const [experienceYears, setExperienceYears] = useState(
    String(cachedProfile?.experienceYears ?? 1)
  );
  const [priceInput, setPriceInput] = useState(
    cachedProfile?.priceCents
      ? (maskPriceInput(String(cachedProfile.priceCents)) || "0,00")
      : "120,00"
  );
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>(
    Array.isArray(cachedProfile?.specialties) ? (cachedProfile!.specialties as string[]) : []
  );
  const [customSpecialty, setCustomSpecialty] = useState("");
  // Locations / academies
  const [fixedLocations, setFixedLocations] = useState<ProviderFixedLocation[]>(
    Array.isArray(cachedProfile?.fixedLocations) ? (cachedProfile!.fixedLocations as ProviderFixedLocation[]) : []
  );
  // Global state
  const [loading, setLoading] = useState(!cachedProfile); // se já tem cache, não mostra spinner
  const [savingProfile, setSavingProfile] = useState(false);
  const [hasExistingProfile, setHasExistingProfile] = useState(!!cachedProfile);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const me = await runWithAuth((token) => userApi.me(token));
      setCurrentUser(me);
      const profile = me.providerProfile;
      if (profile) {
        setHasExistingProfile(true);
        setDisplayName(profile.displayName || me.name || "");
        setBio(profile.bio || "");
        setPhotoUrl(profile.photoUrl || "");
        setPhotoPreviewUri(resolveMediaUrl(profile.photoUrl));
        setPresentationVideoUrl((profile as any).presentationVideoUrl ?? null);
        setVideoLocalUri(null);
        setVideoProcessing(false);
        setExperienceYears(String(profile.experienceYears || 1));
        setPriceInput(maskPriceInput(String(profile.priceCents || 0)) || "0,00");
        const specialties = Array.isArray(profile.specialties) ? (profile.specialties as string[]) : [];
        setSelectedSpecialties(specialties);
        setFixedLocations(Array.isArray(profile.fixedLocations) ? (profile.fixedLocations as ProviderFixedLocation[]) : []);
      } else {
        setHasExistingProfile(false);
        setDisplayName(me.name || "");
      }
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar perfil profissional.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, setCurrentUser, showToast]);

  useEffect(() => { void load(); }, [load]);

  function toggleSpecialty(name: string) {
    setSelectedSpecialties((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  }

  function addCustomSpecialty() {
    const name = customSpecialty.trim();
    if (!name || selectedSpecialties.includes(name)) return;
    setSelectedSpecialties((prev) => [...prev, name]);
    setCustomSpecialty("");
  }

  async function doPickPhoto(fromCamera: boolean) {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (fromCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") { showToast("Permissão para câmera não concedida.", "error"); return; }
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") { showToast("Permissão para galeria não concedida.", "error"); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
      }
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      if (asset.base64) {
        const estimatedBytes = Math.ceil((asset.base64.length * 3) / 4);
        if (estimatedBytes > 3 * 1024 * 1024) { showToast("A foto deve ter no máximo 3MB.", "error"); return; }
      }
      const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const mimeType = asset.mimeType ?? "image/jpeg";
      if (!allowedTypes.includes(mimeType)) { showToast("Use JPEG, PNG ou WebP.", "error"); return; }
      const dataUri = asset.base64 ? `data:${mimeType};base64,${asset.base64}` : asset.uri;
      setPhotoUrl(dataUri);
      setPhotoPreviewUri(asset.uri ?? dataUri);
      showToast("Foto selecionada. Salve o perfil para concluir.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Falha ao selecionar a foto.", "error");
    }
  }

  function pickProfilePhoto() {
    Alert.alert("Foto do perfil", "Escolha uma opção", [
      { text: "Câmera", onPress: () => void doPickPhoto(true) },
      { text: "Galeria", onPress: () => void doPickPhoto(false) },
      { text: "Cancelar", style: "cancel" },
    ]);
  }

  async function doPickPresentationVideo() {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") { showToast("Permissão para galeria não concedida.", "error"); return; }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        videoMaxDuration: 60,
        quality: 0.3,
        base64: false,
      });

      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      const duration = asset.duration ?? 0;
      if (duration > 61_000) {
        showToast("O vídeo deve ter no máximo 1 minuto. Use a ferramenta de corte para ajustar.", "error");
        return;
      }

      // Step 1: store the local file:// URI immediately for crash-free preview.
      // Never pass data:video/ base64 to WebView — 30-40MB URI exhausts mobile memory.
      setVideoLocalUri(asset.uri);
      setPresentationVideoUrl(null); // clear previous data URI until new one is ready
      setVideoProcessing(true);
      showToast("Vídeo selecionado. Processando...", "success");

      // Step 2: read file and convert to base64 data URI (only used at submit time)
      try {
        const response = await fetch(asset.uri);
        const blob = await response.blob();

        if (blob.size > 30 * 1024 * 1024) {
          showToast("O vídeo excede 30MB mesmo comprimido. Grave um vídeo mais curto ou em menor resolução.", "error");
          setVideoLocalUri(null);
          setVideoProcessing(false);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUri = reader.result as string;
          setPresentationVideoUrl(dataUri);
          setVideoProcessing(false);
          showToast("Vídeo pronto. Salve o perfil para publicar.", "success");
        };
        reader.onerror = () => {
          showToast("Falha ao processar o vídeo. Tente outro arquivo.", "error");
          setVideoLocalUri(null);
          setVideoProcessing(false);
        };
        reader.readAsDataURL(blob);
      } catch {
        showToast("Falha ao ler o vídeo. Tente novamente.", "error");
        setVideoLocalUri(null);
        setVideoProcessing(false);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Falha ao selecionar o vídeo.", "error");
    }
  }

  async function submitProfile() {
    if (videoProcessing) { showToast("Aguarde o processamento do vídeo terminar.", "error"); return; }
    if (!displayName.trim() || !bio.trim()) { showToast("Preencha nome e biografia.", "error"); return; }
    if (bio.trim().length < 10) { showToast("Biografia deve ter ao menos 10 caracteres.", "error"); return; }
    const parsedExperience = Math.round(Number(experienceYears));
    if (!Number.isFinite(parsedExperience) || parsedExperience < 0) { showToast("Informe anos de experiência válidos (número inteiro).", "error"); return; }
    const parsedPriceCents = parsePriceToCents(priceInput);
    if (!Number.isFinite(parsedPriceCents) || parsedPriceCents < 100) { showToast("Preço obrigatório. Informe ao menos R$ 1,00.", "error"); return; }
    if (selectedSpecialties.length === 0) { showToast("Selecione ao menos uma especialidade.", "error"); return; }

    const profilePayload = {
      displayName: displayName.trim(),
      bio: bio.trim(),
      photoUrl: photoUrl.trim() || undefined,
      presentationVideoUrl: presentationVideoUrl ?? undefined,
      experienceYears: parsedExperience,
      priceCents: parsedPriceCents,
      specialties: selectedSpecialties,
      fixedLocations: fixedLocations.map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address ?? undefined,
        latitude: l.latitude ?? undefined,
        longitude: l.longitude ?? undefined,
      })),
    };

    try {
      setSavingProfile(true);
      if (hasExistingProfile) {
        await runWithAuth((token) => providersApi.updateProfile(token, profilePayload));
        showToast("Perfil atualizado com sucesso.", "success");
      } else {
        await runWithAuth((token) => providersApi.createProfile(token, profilePayload));
        showToast("Perfil profissional criado com sucesso.", "success");
      }
      await syncCurrentUser();
      await load();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar perfil.", navigation });
    } finally {
      setSavingProfile(false);
    }
  }

  const goBack = () => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ProfessionalTabs", { screen: "ProfessionalHome" });
    else navigation.goBack();
  };

  const goToStack = (screen: string) => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate(screen);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? undefined : "height"}>

      {/* Header */}
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <TouchableOpacity
          onPress={goBack}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Meu perfil</MvText>
          <MvText variant="body4" color="secondary">Configure sua presença no app</MvText>
        </View>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 14 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        {/* Status badge */}
        <MvBadge
          label={hasExistingProfile ? "Perfil ativo — editando" : "Primeiro acesso — crie seu perfil"}
          variant={hasExistingProfile ? "green" : "blue"}
        />

        {/* ─── PASSO 1 ─── */}
        <StepHeader step={1} title="Quem sou eu?" subtitle="Foto, apresentação e especialidades" />

        {/* Foto circular */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 12 }}>Foto do perfil</MvText>
          <View style={{ alignItems: "center", marginBottom: 12 }}>
            {photoPreviewUri ? (
              <View style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2, overflow: "hidden", borderWidth: 2, borderColor: "rgba(34,197,94,0.40)" }}>
                <Image
                  source={{ uri: photoPreviewUri }}
                  style={{ width: PHOTO_SIZE, height: PHOTO_SIZE }}
                  resizeMode="cover"
                />
              </View>
            ) : (
              <View style={{
                width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2,
                backgroundColor: theme.inputBg, borderWidth: 1.5, borderColor: theme.border,
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons name="person-outline" size={48} color={theme.text3} />
              </View>
            )}
          </View>
          <MvButton variant="outline" label="Escolher foto" onPress={pickProfilePhoto} />
        </MvCard>

        {/* Vídeo de apresentação */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 4 }}>Vídeo de apresentação</MvText>
          <MvText variant="body4" color="secondary" style={{ marginBottom: 12 }}>
            Grave um vídeo de até 1 minuto se apresentando. Ele aparece no seu card para os alunos.
          </MvText>
          {videoLocalUri ? (
            // Fresh pick — use file:// URI for crash-free preview (never pass data:video/ to WebView)
            <View style={{ gap: 10 }}>
              <MvVideoPlayer url={videoLocalUri} height={180} borderRadius={10} />
              {videoProcessing && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
                  <ActivityIndicator size="small" color="#22C55E" />
                  <MvText variant="body4" color="secondary">Processando vídeo para salvar…</MvText>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Trocar vídeo" onPress={() => void doPickPresentationVideo()} />
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert("Remover vídeo", "Deseja remover o vídeo de apresentação?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Remover", style: "destructive", onPress: () => { setVideoLocalUri(null); setPresentationVideoUrl(null); setVideoProcessing(false); } },
                    ]);
                  }}
                  style={{
                    width: 44, height: 44, borderRadius: 10,
                    backgroundColor: "rgba(244,67,54,0.08)",
                    borderWidth: 1, borderColor: "rgba(244,67,54,0.25)",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="#f44336" />
                </TouchableOpacity>
              </View>
            </View>
          ) : presentationVideoUrl ? (
            // Loaded from backend (data:video/ URI) — show saved indicator, can't play in WebView
            <View style={{ gap: 10 }}>
              <View style={{
                height: 90, borderRadius: 10,
                backgroundColor: theme.chipBg,
                borderWidth: 1, borderColor: theme.border,
                alignItems: "center", justifyContent: "center",
                gap: 6,
              }}>
                <Ionicons name="videocam" size={28} color={theme.textGreen} />
                <MvText variant="semi3" style={{ color: theme.textGreen }}>Vídeo de apresentação salvo</MvText>
                <MvText variant="body4" color="secondary">Selecione um novo vídeo para substituir.</MvText>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Trocar vídeo" onPress={() => void doPickPresentationVideo()} />
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert("Remover vídeo", "Deseja remover o vídeo de apresentação?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Remover", style: "destructive", onPress: () => { setVideoLocalUri(null); setPresentationVideoUrl(null); setVideoProcessing(false); } },
                    ]);
                  }}
                  style={{
                    width: 44, height: 44, borderRadius: 10,
                    backgroundColor: "rgba(244,67,54,0.08)",
                    borderWidth: 1, borderColor: "rgba(244,67,54,0.25)",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="#f44336" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <MvButton variant="outline" label="Selecionar vídeo da galeria" onPress={() => void doPickPresentationVideo()} />
          )}
        </MvCard>

        {/* Dados básicos */}
        <MvCard>
          <View style={{ gap: 10 }}>
            <MvInput placeholder="Nome de exibição (Ex: Carlos Trainer)" value={displayName} onChangeText={setDisplayName} />
            <MvInput placeholder="Biografia — conte sua experiência e diferencial" multiline numberOfLines={4} value={bio} onChangeText={setBio} />
            <MvInput keyboardType="numeric" placeholder="Anos de experiência" value={experienceYears} onChangeText={setExperienceYears} />
            <MvInput keyboardType="numeric" placeholder="Preço por sessão (R$)" value={priceInput} onChangeText={(v) => setPriceInput(maskPriceInput(v))} />
            <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10, backgroundColor: theme.inputBg }}>
              <MvText variant="semi3">Divisão automática</MvText>
              <MvText variant="body4" color="secondary">90% para você · 10% de comissão para o app.</MvText>
            </View>
          </View>
        </MvCard>

        {/* Especialidades */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 4 }}>Especialidades</MvText>
          <MvText variant="body4" color="secondary" style={{ marginBottom: 10 }}>
            Selecione as áreas em que você atua ou adicione uma nova.
          </MvText>
          {loading ? (
            <MvText variant="body4" color="secondary">Carregando...</MvText>
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {PROFESSIONAL_SPECIALTIES.map((name) => {
                  const selected = selectedSpecialties.includes(name);
                  return (
                    <TouchableOpacity
                      key={name}
                      onPress={() => toggleSpecialty(name)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                        backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.chipBg,
                        borderWidth: 1, borderColor: selected ? "rgba(34,197,94,0.30)" : theme.border,
                      }}
                    >
                      <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                        {name}
                      </MvText>
                    </TouchableOpacity>
                  );
                })}
                {/* Custom specialties not in predefined list */}
                {selectedSpecialties.filter((s) => !PROFESSIONAL_SPECIALTIES.some((defaultSpecialty) => defaultSpecialty === s)).map((name) => (
                  <TouchableOpacity
                    key={name}
                    onPress={() => toggleSpecialty(name)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                      backgroundColor: "rgba(34,197,94,0.12)",
                      borderWidth: 1, borderColor: "rgba(34,197,94,0.30)",
                      flexDirection: "row", alignItems: "center", gap: 4,
                    }}
                  >
                    <MvText variant="body4" style={{ color: theme.textGreen }}>{name}</MvText>
                    <Ionicons name="close" size={12} color={theme.textGreen} />
                  </TouchableOpacity>
                ))}
              </View>

              {/* Add custom specialty */}
              <View style={{ flexDirection: "row", gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <MvInput
                    placeholder="Adicionar especialidade personalizada..."
                    value={customSpecialty}
                    onChangeText={setCustomSpecialty}
                    onSubmitEditing={addCustomSpecialty}
                    returnKeyType="done"
                  />
                </View>
                <TouchableOpacity
                  onPress={addCustomSpecialty}
                  style={{
                    width: 44, height: 44, borderRadius: 10,
                    backgroundColor: "rgba(34,197,94,0.12)",
                    borderWidth: 1, borderColor: "rgba(34,197,94,0.30)",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Ionicons name="add" size={20} color="#22C55E" />
                </TouchableOpacity>
              </View>
            </>
          )}
        </MvCard>

        {/* Save Step 1 */}
        <MvButton label={hasExistingProfile ? "Salvar alterações" : "Criar perfil"} loading={savingProfile} onPress={() => void submitProfile()} />

        {/* ─── PASSO 2 ─── */}
        <StepHeader
          step={2}
          title="Meus Horários"
          subtitle={hasExistingProfile ? "Configure seus horários disponíveis" : "Complete o Passo 1 primeiro"}
          locked={!hasExistingProfile}
        />
        <MvCard>
          {hasExistingProfile ? (
            <View style={{ gap: 8 }}>
              <MvText variant="body3" color="secondary">
                Defina os dias e horários em que você está disponível para atender alunos.
              </MvText>
              <MvButton variant="outline" label="Meus Horários" onPress={() => goToStack("AvailabilityManager")} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: 0.5 }}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.text3} />
              <MvText variant="body3" color="secondary">Salve o Passo 1 para desbloquear.</MvText>
            </View>
          )}
        </MvCard>

        {/* ─── PASSO 3 ─── */}
        <StepHeader
          step={3}
          title="Consultoria Online"
          subtitle={hasExistingProfile ? "Configure sua oferta de consultoria" : "Complete o Passo 1 primeiro"}
          locked={!hasExistingProfile}
        />
        <MvCard>
          {hasExistingProfile ? (
            <View style={{ gap: 8 }}>
              <MvText variant="body3" color="secondary">
                Ative e configure seus serviços de consultoria online para atender alunos à distância.
              </MvText>
              <MvButton variant="outline" label="Configurar consultoria online" onPress={() => goToStack("ProfessionalConsultancyCenter")} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: 0.5 }}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.text3} />
              <MvText variant="body3" color="secondary">Salve o Passo 1 para desbloquear.</MvText>
            </View>
          )}
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 4 }}>Área de atendimento</MvText>
          <MvText variant="body4" color="secondary">
            O mapa, o raio e os locais de atendimento agora são configurados na tela inicial do profissional.
          </MvText>
        </MvCard>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

