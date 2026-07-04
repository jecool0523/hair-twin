import { HairStylePreset, QualityCheck } from "./types";

export const HAIR_STYLE_PRESETS: HairStylePreset[] = [
  {
    id: "layered-c-curl",
    nameKo: "레이어드 C컬",
    category: "컷 + 펌",
    consultationSummary: "얼굴선을 부드럽게 감싸는 중단발/긴머리 레이어와 끝 C컬",
    normalizedDescription:
      "medium to long layered haircut with soft C-curl ends, natural face-framing layers, salon-realistic volume",
    promptTags: ["레이어", "C컬", "얼굴선 보정"],
    accent: "#7dd3fc",
    mockProfile: "medium"
  },
  {
    id: "see-through-bob",
    nameKo: "시스루뱅 단발",
    category: "컷",
    consultationSummary: "가벼운 앞머리와 턱선 근처의 산뜻한 단발 실루엣",
    normalizedDescription:
      "short bob haircut with airy see-through bangs, light texture, natural Korean salon finish",
    promptTags: ["단발", "시스루뱅", "가벼운 질감"],
    accent: "#f0abfc",
    mockProfile: "short"
  },
  {
    id: "hush-cut",
    nameKo: "허쉬컷",
    category: "컷",
    consultationSummary: "층감과 움직임이 살아있는 가벼운 샤기 레이어",
    normalizedDescription:
      "hush cut with airy shaggy layers, soft movement around cheekbones and neckline, natural texture",
    promptTags: ["허쉬", "층감", "움직임"],
    accent: "#a7f3d0",
    mockProfile: "medium"
  },
  {
    id: "long-wave",
    nameKo: "긴 웨이브",
    category: "펌",
    consultationSummary: "긴 기장에 흐르는 듯한 굵은 웨이브와 윤기",
    normalizedDescription:
      "long hairstyle with loose flowing waves, glossy natural texture, soft salon blowout finish",
    promptTags: ["롱헤어", "굵은 웨이브", "윤기"],
    accent: "#fde68a",
    mockProfile: "long"
  },
  {
    id: "tassel-cut",
    nameKo: "태슬컷",
    category: "컷",
    consultationSummary: "끝선이 단정하게 떨어지는 세련된 스트레이트 단발",
    normalizedDescription:
      "sleek tassel bob haircut with clean blunt ends, polished straight texture, refined salon look",
    promptTags: ["태슬", "스트레이트", "끝선"],
    accent: "#fca5a5",
    mockProfile: "sleek"
  },
  {
    id: "ash-brown-tone-down",
    nameKo: "애쉬 브라운 톤다운",
    category: "컬러",
    consultationSummary: "붉은기를 낮춘 차분한 애쉬 브라운 컬러",
    normalizedDescription:
      "ash brown toned-down hair color, reduced red undertone, natural dimensional salon color",
    promptTags: ["애쉬", "브라운", "톤다운"],
    accent: "#c4b5fd",
    mockProfile: "color"
  },
  {
    id: "balayage",
    nameKo: "발레아쥬",
    category: "컬러",
    consultationSummary: "자연스럽게 번지는 하이라이트와 입체적인 컬러감",
    normalizedDescription:
      "soft balayage highlights with natural gradient, dimensional color around mid-lengths and ends",
    promptTags: ["하이라이트", "그라데이션", "입체감"],
    accent: "#fdba74",
    mockProfile: "color"
  },
  {
    id: "volume-magic",
    nameKo: "볼륨매직",
    category: "펌",
    consultationSummary: "차분한 스트레이트에 뿌리와 끝 볼륨을 살린 스타일",
    normalizedDescription:
      "smooth volume rebonding hairstyle, sleek straight texture with natural root lift and curved ends",
    promptTags: ["볼륨매직", "차분함", "뿌리볼륨"],
    accent: "#99f6e4",
    mockProfile: "sleek"
  },
  {
    id: "leaf-cut",
    nameKo: "리프컷",
    category: "컷",
    consultationSummary: "앞머리와 옆머리가 자연스럽게 흐르는 중성적 리프 실루엣",
    normalizedDescription:
      "leaf cut with flowing side-swept fringe, soft layers around ears and neckline, gender-neutral salon style",
    promptTags: ["리프", "중성적", "흐름"],
    accent: "#86efac",
    mockProfile: "medium"
  },
  {
    id: "dandy-cut",
    nameKo: "댄디컷",
    category: "컷",
    consultationSummary: "깔끔한 앞머리와 단정한 사이드 라인의 데일리 컷",
    normalizedDescription:
      "clean dandy haircut with neat fringe, tidy side line, natural volume, refined everyday salon finish",
    promptTags: ["댄디", "깔끔함", "데일리"],
    accent: "#bfdbfe",
    mockProfile: "short"
  }
];

export const EMPTY_QUALITY_CHECK: QualityCheck = {
  faceIdentity: false,
  skinExpression: false,
  hairOnly: false,
  clothesBackground: false,
  salonNatural: false,
  styleMatch: false
};

export const QUALITY_LABELS: Array<{ key: keyof QualityCheck; label: string }> = [
  { key: "faceIdentity", label: "얼굴이 원본과 동일하게 보이는가" },
  { key: "skinExpression", label: "피부톤/표정이 유지되는가" },
  { key: "hairOnly", label: "헤어만 변경되었는가" },
  { key: "clothesBackground", label: "의상/배경이 유지되는가" },
  { key: "salonNatural", label: "미용 상담용으로 자연스러운가" },
  { key: "styleMatch", label: "길이/컬러/볼륨이 프리셋과 맞는가" }
];

export const STORAGE_KEYS = {
  candidates: "hair-twin.saved-candidates",
  note: "hair-twin.consultation-note"
} as const;
