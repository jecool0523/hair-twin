export enum AppState {
  CAPTURE = "CAPTURE",
  READY = "READY",
  GENERATING = "GENERATING",
  RESULTS = "RESULTS",
  ERROR = "ERROR"
}

export type CandidateStatus = "needs_review" | "usable" | "regenerate";
export type ProviderStatus = "mock_preview" | "gemini_ready" | "api_key_missing" | "generation_failed";

export interface HairStylePreset {
  id: string;
  nameKo: string;
  category: string;
  consultationSummary: string;
  normalizedDescription: string;
  promptTags: string[];
  accent: string;
  mockProfile: "short" | "medium" | "long" | "color" | "wave" | "sleek";
}

export interface QualityCheck {
  faceIdentity: boolean;
  skinExpression: boolean;
  hairOnly: boolean;
  clothesBackground: boolean;
  salonNatural: boolean;
  styleMatch: boolean;
}

export interface GenerationMetadata {
  provider: "gemini" | "mock";
  providerStatus: ProviderStatus;
  styleId: string;
  styleName: string;
  prompt: string;
  variantIndex: number;
  createdAt: string;
  durationMs: number;
  generationMode: "hair_style_simulation";
  isMock: boolean;
  failureReason?: string;
  warning?: string;
}

export interface GeneratedCandidate {
  id: string;
  image: string;
  sourceImage?: string;
  styleId: string;
  styleName: string;
  variantLabel: string;
  status: CandidateStatus;
  qualityCheck: QualityCheck;
  metadata: GenerationMetadata;
  savedAt?: string;
}

export interface ConsultationNote {
  memo: string;
  customerAlias: string;
  stylistName: string;
  sourceImageSaved: boolean;
  updatedAt: string;
}

export interface ConsultationSession {
  id: string;
  sourceImage?: string;
  selectedStyleId: string;
  selectedStyleName: string;
  note: ConsultationNote;
  candidates: GeneratedCandidate[];
  providerStatus: ProviderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SavedConsultation {
  id: string;
  session: ConsultationSession;
  savedAt: string;
}

export interface GenerationRequest {
  sourceImage: string;
  style: HairStylePreset;
  count: number;
  consultationNote?: string;
  variantStart?: number;
  forceMock?: boolean;
}
