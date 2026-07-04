import { QUALITY_LABELS } from "../constants";
import { CandidateStatus, QualityCheck } from "../types";

interface QualityChecklistProps {
  qualityCheck: QualityCheck;
  status: CandidateStatus;
  onToggle: (key: keyof QualityCheck) => void;
  onStatusChange: (status: CandidateStatus) => void;
}

const STATUS_LABELS: Record<CandidateStatus, string> = {
  needs_review: "검토 필요",
  usable: "사용 가능",
  regenerate: "재생성 권장"
};

function QualityChecklist({
  qualityCheck,
  status,
  onToggle,
  onStatusChange
}: QualityChecklistProps) {
  return (
    <div className="quality-panel">
      <div className="quality-header">
        <span>품질 체크</span>
        <select value={status} onChange={(event) => onStatusChange(event.target.value as CandidateStatus)}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="quality-list">
        {QUALITY_LABELS.map(({ key, label }) => (
          <label key={key} className="quality-row">
            <input
              type="checkbox"
              checked={qualityCheck[key]}
              onChange={() => onToggle(key)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default QualityChecklist;
