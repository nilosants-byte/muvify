export interface UserProgress {
  level: number;
  points: number;
  streak: number;            // dias consecutivos
  weeklyGoal: { current: number; target: number };
  monthlyGoal: { current: number; target: number };
  totalWorkouts: number;
}

export interface Achievement {
  id: string;
  icon: string;              // nome do ícone Ionicons
  label: string;
  description: string;
  requirement: string;
  unlocked: boolean;
  unlockedAt?: Date;
  points: number;
  tier: "bronze" | "silver" | "gold" | "diamond" | "special";
  category?: string;
  progress?: { current: number; target: number };
}

export interface RankingEntry {
  userId: string;
  name: string;
  initials: string;
  points: number;
  isCurrentUser: boolean;
  avatar?: string;
  tone?: "green" | "amber" | "blue";
}

export interface FeedEntry {
  id: string;
  userId: string;
  name: string;
  initials: string;
  tone: "green" | "amber" | "blue";
  text: string;
  iconName: string;
  iconColor: string;
  timestamp: string;
}
