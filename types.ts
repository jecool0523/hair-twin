export interface BodyAnalysis {
  heightEstimate: string;
  shoulderWidth: string;
  bodyShape: string;
  suggestedSize: string;
  styleAdvice: string;
}

export interface ClothingItem {
  id: string;
  name: string;
  category: string;
  description: string; // The prompt sent to Gemini
  image: string; // Placeholder or uploaded image URL
  isCustom?: boolean; // Flag to indicate if this is a user-uploaded clothing item
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  SHOPPING = 'SHOPPING',
  GENERATING_TRYON = 'GENERATING_TRYON',
  RESULT = 'RESULT',
}
