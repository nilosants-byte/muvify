import { ImageSourcePropType } from "react-native";

type OnboardingSlide = {
  id: string;
  imageSource: ImageSourcePropType;
  title: string;
  subtitle: string;
};

export const onboardingSlides: OnboardingSlide[] = [
  {
    id: "slide-1",
    imageSource: require("../../assets/onboarding/agachamento.jpeg"),
    title: "Evolua com acompanhamento profissional",
    subtitle: "Conecte-se a especialistas para treinar com segurança, consistência e resultado."
  },
  {
    id: "slide-2",
    imageSource: require("../../assets/onboarding/supino.jpeg"),
    title: "Agenda simples, rotina organizada",
    subtitle: "Agende seus horários em poucos toques e mantenha seu plano ativo sem complicação."
  }
];
