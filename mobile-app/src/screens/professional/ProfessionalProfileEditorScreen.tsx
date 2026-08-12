import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MvVideoPlayer } from "../../components/mv/MvVideoPlayer";
import { ProfessionalTabParamList } from "../../navigation/route-types";
import {
  ApiError,
  PROFESSIONAL_SPECIALTIES,
  ProviderFixedLocation,
  providersApi,
  uploadsApi,
  userApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { maskPriceInput } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { resolveMediaUrl } from "../../utils/media";

type Props = BottomTabScreenProps<ProfessionalTabParamList, "ProfessionalProfileEditor">;

const PHOTO_SIZE = 140;

function parsePriceToCents(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
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
  // Local file:// URI for crash-free preview; URL real do R2 vive em presentationVideoUrl para submissão
  const [videoLocalUri, setVideoLocalUri] = useState<string | null>(null);
  const [videoProcessing, setVideoProcessing] = useState(false);
  // Frente 11 (engenharia mobile), Lote 2: antes só existia um spinner
  // indeterminado — sem noção de quanto falta pra um vídeo de até 40MB.
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  // Sinaliza que o usuário removeu um vídeo já salvo — precisa virar "" no payload para o backend apagar
  const [videoRemoved, setVideoRemoved] = useState(false);
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
  const profileQuery = useAuthQuery(
    queryKeys.user.me(),
    (token) => userApi.me(token),
  );

  const loading = profileQuery.isLoading;
  const [savingProfile, setSavingProfile] = useState(false);
  const [hasExistingProfile, setHasExistingProfile] = useState(!!cachedProfile);

  useEffect(() => {
    const me = profileQuery.data;
    if (!me) return;
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
      setVideoRemoved(false);
      setExperienceYears(String(profile.experienceYears || 1));
      setPriceInput(maskPriceInput(String(profile.priceCents || 0)) || "0,00");
      const specialties = Array.isArray(profile.specialties) ? (profile.specialties as string[]) : [];
      setSelectedSpecialties(specialties);
      setFixedLocations(Array.isArray(profile.fixedLocations) ? (profile.fixedLocations as ProviderFixedLocation[]) : []);
    } else {
      setHasExistingProfile(false);
      setDisplayName(me.name || "");
    }
  }, [profileQuery.data, setCurrentUser]);

  useEffect(() => {
    if (profileQuery.error) {
      handleScreenError({ error: profileQuery.error, showToast, fallbackMessage: "Falha ao carregar perfil profissional.", navigation });
    }
  }, [profileQuery.error, showToast, navigation]);

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
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.5 });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") { showToast("Permissão para galeria não concedida.", "error"); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
      }
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      if (asset.fileSize && asset.fileSize > 3 * 1024 * 1024) { showToast("A foto deve ter no máximo 3MB.", "error"); return; }
      const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const mimeType = asset.mimeType ?? "image/jpeg";
      if (!allowedTypes.includes(mimeType)) { showToast("Use JPEG, PNG ou WebP.", "error"); return; }
      setPhotoPreviewUri(asset.uri);
      showToast("Enviando foto...", "info");
      const { url } = await runWithAuth((token) =>
        uploadsApi.uploadMedia(token, { uri: asset.uri, mimeType, fileName: "profile-photo.jpg" }, "profile-photos")
      );
      setPhotoUrl(url);
      showToast("Foto enviada. Salve o perfil para concluir.", "success");
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao selecionar a foto.", navigation });
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
      });

      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      const duration = asset.duration ?? 0;
      if (duration > 61_000) {
        showToast("O vídeo deve ter no máximo 1 minuto. Use a ferramenta de corte para ajustar.", "error");
        return;
      }

      const allowedTypes = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp"];
      const mimeType = asset.mimeType ?? "video/mp4";
      if (!allowedTypes.includes(mimeType)) { showToast("Use MP4, MOV, WebM ou 3GP.", "error"); return; }

      if (asset.fileSize && asset.fileSize > 40 * 1024 * 1024) {
        showToast("O vídeo deve ter no máximo 40MB. Use a ferramenta de corte para reduzir.", "error");
        return;
      }

      // Prévia local (file://) — o vídeo em si nunca é convertido pra base64 na memória do app.
      setVideoLocalUri(asset.uri);
      setPresentationVideoUrl(null); // limpa a URL anterior até o novo upload terminar
      setVideoRemoved(false);
      setVideoProcessing(true);
      setVideoUploadProgress(0);

      const extension = mimeType === "video/quicktime" ? "mov" : mimeType === "video/webm" ? "webm" : mimeType === "video/3gpp" ? "3gp" : "mp4";
      const { url } = await runWithAuth((token) =>
        uploadsApi.uploadMedia(
          token,
          { uri: asset.uri, mimeType, fileName: `presentation-video.${extension}`, fileSizeBytes: asset.fileSize },
          "presentation-videos",
          setVideoUploadProgress
        )
      );
      setPresentationVideoUrl(url);
      setVideoLocalUri(null); // troca pra URL real do R2 assim que sobe — a prévia local pode não tocar no WebView
      setVideoProcessing(false);
      showToast("Vídeo enviado. Salve o perfil para concluir.", "success");
    } catch (error) {
      setVideoProcessing(false);
      // Frente 11 (engenharia mobile), Lote 2: videoLocalUri não é limpo em
      // caso de falha — a prévia e o botão "Trocar vídeo" continuam
      // visíveis, então tentar de novo é reabrir a galeria e reselecionar o
      // mesmo arquivo (poucos toques), não recomeçar o fluxo do zero.
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao enviar o vídeo.", navigation });
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

    // Só reenvia URLs de mídia se forem novos uploads (data URI) ou URLs absolutas.
    // Caminhos relativos da API (/uploads/...) não são URLs válidas para o backend.
    const isUploadableUrl = (v: string | null | undefined) =>
      !!v && (v.startsWith("data:") || v.startsWith("http://") || v.startsWith("https://"));

    const profilePayload = {
      displayName: displayName.trim(),
      bio: bio.trim(),
      photoUrl: isUploadableUrl(photoUrl.trim()) ? photoUrl.trim() : undefined,
      presentationVideoUrl: videoRemoved
        ? ""
        : isUploadableUrl(presentationVideoUrl) ? presentationVideoUrl! : undefined,
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
      void profileQuery.refetch();
    } catch (error) {
      // Se a criação teve sucesso no servidor mas a resposta não chegou a
      // tempo (timeout/queda de rede), o app não sabia disso e continuava
      // tentando criar de novo, recebendo 409 repetidamente. Recarrega o
      // perfil real e já entra em modo edição, em vez de deixar o usuário
      // preso reenviando o mesmo formulário.
      if (!hasExistingProfile && error instanceof ApiError && error.status === 409) {
        await profileQuery.refetch();
        showToast("Você já tem um perfil profissional - editando o existente.", "info");
      } else {
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar perfil.", navigation });
      }
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
        <PressableScale
          scale={0.92}
          onPress={goBack}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, letterSpacing: -0.3 }}>Meu perfil</MvText>
          <MvText variant="body4" color="secondary">
            {hasExistingProfile ? "Editando perfil público" : "Configure sua presença no app"}
          </MvText>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView automaticallyAdjustKeyboardInsets={true} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 14 }} showsVerticalScrollIndicator={false}>

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
                  <ActivityIndicator size="small" color={theme.primary} />
                  <MvText variant="body4" color="secondary">
                    {videoUploadProgress > 0
                      ? `Enviando vídeo… ${Math.round(videoUploadProgress * 100)}%`
                      : "Enviando vídeo…"}
                  </MvText>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Trocar vídeo" onPress={() => void doPickPresentationVideo()} />
                </View>
                <PressableScale
                  scale={0.92}
                  onPress={() => {
                    Alert.alert("Remover vídeo", "Deseja remover o vídeo de apresentação?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Remover", style: "destructive", onPress: () => { setVideoLocalUri(null); setPresentationVideoUrl(null); setVideoProcessing(false); setVideoRemoved(true); } },
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
                </PressableScale>
              </View>
            </View>
          ) : presentationVideoUrl ? (
            // Carregado do backend — já é uma URL real do R2, pode reproduzir normalmente
            <View style={{ gap: 10 }}>
              <MvVideoPlayer url={resolveMediaUrl(presentationVideoUrl) ?? presentationVideoUrl} height={180} borderRadius={10} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Trocar vídeo" onPress={() => void doPickPresentationVideo()} />
                </View>
                <PressableScale
                  scale={0.92}
                  onPress={() => {
                    Alert.alert("Remover vídeo", "Deseja remover o vídeo de apresentação?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Remover", style: "destructive", onPress: () => { setVideoLocalUri(null); setPresentationVideoUrl(null); setVideoProcessing(false); setVideoRemoved(true); } },
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
                </PressableScale>
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
            <MvInput placeholder="Biografia — conte sua experiência e diferencial" multiline numberOfLines={4} maxLength={500} value={bio} onChangeText={setBio} />
            <MvText variant="caption" color="secondary" style={{ textAlign: "right", marginTop: -6 }}>
              {bio.length < 10 ? `Mínimo 10 caracteres (${bio.length}/500)` : `${bio.length}/500`}
            </MvText>
            <MvInput keyboardType="numeric" placeholder="Anos de experiência" value={experienceYears} onChangeText={setExperienceYears} maxLength={2} />
            <MvInput keyboardType="numeric" placeholder="Preço por sessão (R$)" value={priceInput} onChangeText={(v) => setPriceInput(maskPriceInput(v))} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
              <Ionicons name="information-circle-outline" size={14} color={theme.text3} />
              <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>
                Você recebe 90% · 10% vai para o app
              </MvText>
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
                    <PressableScale
                      key={name}
                      scale={0.95}
                      onPress={() => toggleSpecialty(name)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                        backgroundColor: selected ? theme.primarySubtle : theme.chipBg,
                        borderWidth: 1, borderColor: selected ? "rgba(34,197,94,0.30)" : theme.border,
                      }}
                    >
                      <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                        {name}
                      </MvText>
                    </PressableScale>
                  );
                })}
                {/* Custom specialties not in predefined list */}
                {selectedSpecialties.filter((s) => !PROFESSIONAL_SPECIALTIES.some((defaultSpecialty) => defaultSpecialty === s)).map((name) => (
                  <PressableScale
                    key={name}
                    scale={0.95}
                    onPress={() => toggleSpecialty(name)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                      backgroundColor: theme.primarySubtle,
                      borderWidth: 1, borderColor: "rgba(34,197,94,0.30)",
                      flexDirection: "row", alignItems: "center", gap: 4,
                    }}
                  >
                    <MvText variant="body4" style={{ color: theme.textGreen }}>{name}</MvText>
                    <Ionicons name="close" size={12} color={theme.textGreen} />
                  </PressableScale>
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
                <PressableScale
                  scale={0.92}
                  onPress={addCustomSpecialty}
                  style={{
                    width: 44, height: 44, borderRadius: 10,
                    backgroundColor: theme.primarySubtle,
                    borderWidth: 1, borderColor: "rgba(34,197,94,0.30)",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Ionicons name="add" size={20} color={theme.primary} />
                </PressableScale>
              </View>
            </>
          )}
        </MvCard>

        <MvButton label={hasExistingProfile ? "Salvar alterações" : "Criar perfil"} loading={savingProfile} onPress={() => void submitProfile()} />

        {/* ─── Configurações complementares ─── */}
        {hasExistingProfile ? (
          <View style={{ gap: 8 }}>
            <MvText variant="semi3" color="secondary" style={{ paddingHorizontal: 2, marginBottom: 2 }}>
              Configurações complementares
            </MvText>

            <PressableScale
              scale={0.98}
              onPress={() => goToStack("AvailabilityManager")}
              style={{
                flexDirection: "row", alignItems: "center", gap: 12,
                borderRadius: 16, borderWidth: 1,
                borderColor: theme.border, backgroundColor: theme.cardBg,
                paddingHorizontal: 16, paddingVertical: 14,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="calendar-outline" size={18} color={theme.textGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <MvText variant="semi2">Horários e local de atendimento</MvText>
                <MvText variant="body4" color="secondary">Dias/horários disponíveis, área e locais onde você atende</MvText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.text3} />
            </PressableScale>

            <PressableScale
              scale={0.98}
              onPress={() => goToStack("ProfessionalConsultancyCenter")}
              style={{
                flexDirection: "row", alignItems: "center", gap: 12,
                borderRadius: 16, borderWidth: 1,
                borderColor: theme.border, backgroundColor: theme.cardBg,
                paddingHorizontal: 16, paddingVertical: 14,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="videocam-outline" size={18} color={theme.textGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <MvText variant="semi2">Consultoria Online</MvText>
                <MvText variant="body4" color="secondary">Configure suas ofertas de atendimento remoto</MvText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.text3} />
            </PressableScale>

            <PressableScale
              scale={0.98}
              onPress={() => goToStack("ProfessionalCredentials")}
              style={{
                flexDirection: "row", alignItems: "center", gap: 12,
                borderRadius: 16, borderWidth: 1,
                borderColor: theme.border, backgroundColor: theme.cardBg,
                paddingHorizontal: 16, paddingVertical: 14,
              }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="shield-checkmark-outline" size={18} color={theme.textGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <MvText variant="semi2">CREF e Documentos</MvText>
                <MvText variant="body4" color="secondary">Validação da sua certificação profissional</MvText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.text3} />
            </PressableScale>
          </View>
        ) : (
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            borderRadius: 12, borderWidth: 1,
            borderColor: theme.border, backgroundColor: theme.chipBg,
            padding: 12,
          }}>
            <Ionicons name="information-circle-outline" size={18} color={theme.text3} />
            <MvText variant="body4" color="secondary" style={{ flex: 1, lineHeight: 18 }}>
              Após criar seu perfil, você poderá configurar horários, consultoria online e validar seu CREF.
            </MvText>
          </View>
        )}
      </ScrollView>
      </ScreenEntrance>
      </KeyboardAvoidingView>
    </View>
  );
}

