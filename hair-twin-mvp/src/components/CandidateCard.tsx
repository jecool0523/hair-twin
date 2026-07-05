import { Download, RefreshCw, Save, SplitSquareHorizontal } from "lucide-react";
import QualityChecklist from "./QualityChecklist";
import { CandidateStatus, GeneratedCandidate, QualityCheck } from "../types";

interface CandidateCardProps {
  candidate: GeneratedCandidate;
  sourceImage: string;
  compareMode: "side-by-side" | "result-only";
  isBusy: boolean;
  onToggleQuality: (candidateId: string, key: keyof QualityCheck) => void;
  onStatusChange: (candidateId: string, status: CandidateStatus) => void;
  onDownload: (candidate: GeneratedCandidate) => void;
  onSave: (candidate: GeneratedCandidate) => void;
  onRegenerate: (candidate: GeneratedCandidate) => void;
}

const statusClass: Record<CandidateStatus, string> = {
  needs_review: "status-review",
  usable: "status-usable",
  regenerate: "status-regenerate"
};

function CandidateCard({
  candidate,
  sourceImage,
  compareMode,
  isBusy,
  onToggleQuality,
  onStatusChange,
  onDownload,
  onSave,
  onRegenerate
}: CandidateCardProps) {
  const checkedCount = Object.values(candidate.qualityCheck).filter(Boolean).length;

  return (
    <article className="candidate-card">
      <div className="candidate-card-header">
        <div>
          <h3>{candidate.variantLabel}</h3>
          <p>{candidate.styleName}</p>
        </div>
        <span className={`candidate-status ${statusClass[candidate.status]}`}>
          {candidate.status === "needs_review" && "검토 필요"}
          {candidate.status === "usable" && "사용 가능"}
          {candidate.status === "regenerate" && "재생성 권장"}
        </span>
      </div>

      <div className={`comparison-frame ${compareMode}`}>
        {compareMode === "side-by-side" && (
          <div className="comparison-pane">
            <span>원본</span>
            <img src={sourceImage} alt="원본 고객 사진" />
          </div>
        )}
        <div className="comparison-pane">
          <span>결과</span>
          <img src={candidate.image} alt={`${candidate.styleName} 결과`} />
        </div>
      </div>

      <div className="candidate-meta">
        <SplitSquareHorizontal size={15} />
        <span>체크 {checkedCount}/6</span>
        <span>{candidate.metadata.provider === "mock" ? "Mock preview" : "GPT Images"}</span>
      </div>

      <QualityChecklist
        qualityCheck={candidate.qualityCheck}
        status={candidate.status}
        onToggle={(key) => onToggleQuality(candidate.id, key)}
        onStatusChange={(status) => onStatusChange(candidate.id, status)}
      />

      {candidate.metadata.warning && <p className="candidate-warning">{candidate.metadata.warning}</p>}

      <div className="candidate-actions">
        <button type="button" onClick={() => onRegenerate(candidate)} disabled={isBusy}>
          <RefreshCw size={16} />
          다시 생성
        </button>
        <button type="button" onClick={() => onDownload(candidate)}>
          <Download size={16} />
          다운로드
        </button>
        <button type="button" onClick={() => onSave(candidate)}>
          <Save size={16} />
          임시 저장
        </button>
      </div>
    </article>
  );
}

export default CandidateCard;
