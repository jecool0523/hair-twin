import { ChangeEvent, CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  Eye,
  ImagePlus,
  Loader2,
  RotateCcw,
  Save,
  Scissors,
  Sparkles,
  Upload,
  UserRound,
  X,
  XCircle
} from "lucide-react";
import CameraFeed, { CameraFeedHandle } from "./components/CameraFeed";
import CandidateCard from "./components/CandidateCard";
import { HAIR_STYLE_PRESETS, STORAGE_KEYS } from "./constants";
import { generateHairStyleCandidates, getGenerationProviderStatus } from "./services/generationService";
import { readStoredJson, writeStoredJson } from "./services/storage";
import {
  AppState,
  CandidateStatus,
  ConsultationNote,
  ConsultationSession,
  GeneratedCandidate,
  HairStylePreset,
  ProviderStatus,
  QualityCheck
} from "./types";

const createSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const defaultNote = (): ConsultationNote => ({
  memo: "",
  customerAlias: "",
  stylistName: "",
  sourceImageSaved: false,
  updatedAt: new Date().toISOString()
});

const providerLabel: Record<ProviderStatus, string> = {
  mock_preview: "Mock Preview",
  gemini_ready: "Gemini Ready",
  api_key_missing: "API Key Missing",
  generation_failed: "Generation Failed"
};

const createSampleCustomerImage = (): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, "#071016");
  bg.addColorStop(0.55, "#14232c");
  bg.addColorStop(1, "#241b2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 2;
  for (let x = 0; x < canvas.width; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(125,211,252,0.18)";
  ctx.beginPath();
  ctx.ellipse(540, 530, 260, 355, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d9a98f";
  ctx.beginPath();
  ctx.ellipse(540, 520, 190, 245, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#211816";
  ctx.beginPath();
  ctx.ellipse(540, 375, 220, 150, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(335, 365, 410, 150);

  ctx.fillStyle = "rgba(45,30,25,0.95)";
  ctx.beginPath();
  ctx.ellipse(350, 580, 70, 270, -0.2, 0, Math.PI * 2);
  ctx.ellipse(730, 580, 70, 270, 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2e2421";
  ctx.beginPath();
  ctx.arc(470, 520, 14, 0, Math.PI * 2);
  ctx.arc(610, 520, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#7b4a44";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(540, 610, 56, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = "#182936";
  ctx.beginPath();
  ctx.roundRect(250, 835, 580, 430, 80);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "700 42px Arial";
  ctx.fillText("Synthetic Demo Customer", 268, 1320);
  ctx.font = "500 28px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.fillText("Not a real person · Hair Twin MVP sample", 268, 1364);

  return canvas.toDataURL("image/jpeg", 0.94);
};

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.CAPTURE);
  const [sessionId, setSessionId] = useState(createSessionId);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<HairStylePreset>(HAIR_STYLE_PRESETS[0]);
  const [candidates, setCandidates] = useState<GeneratedCandidate[]>([]);
  const [savedCandidates, setSavedCandidates] = useState<GeneratedCandidate[]>([]);
  const [note, setNote] = useState<ConsultationNote>(defaultNote);
  const [compareMode, setCompareMode] = useState<"side-by-side" | "result-only">("side-by-side");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(getGenerationProviderStatus);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [savedReview, setSavedReview] = useState<GeneratedCandidate | null>(null);
  const [progressText, setProgressText] = useState("헤어스타일 후보를 준비 중입니다.");
  const [hasLoadedStoredNote, setHasLoadedStoredNote] = useState(false);

  const cameraRef = useRef<CameraFeedHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSavedCandidates(readStoredJson<GeneratedCandidate[]>(STORAGE_KEYS.candidates, []));
    setNote(readStoredJson<ConsultationNote>(STORAGE_KEYS.note, defaultNote()));
    setHasLoadedStoredNote(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredNote) return;
    writeStoredJson(STORAGE_KEYS.note, note);
  }, [hasLoadedStoredNote, note]);

  useEffect(() => {
    if (!toastMsg) return;
    const timer = window.setTimeout(() => setToastMsg(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toastMsg]);

  const isGenerating = appState === AppState.GENERATING;
  const selectedStyleTags = useMemo(() => selectedStyle.promptTags.join(" · "), [selectedStyle]);

  const currentSession = useMemo<ConsultationSession>(
    () => ({
      id: sessionId,
      sourceImage: note.sourceImageSaved ? sourceImage ?? undefined : undefined,
      selectedStyleId: selectedStyle.id,
      selectedStyleName: selectedStyle.nameKo,
      note,
      candidates,
      providerStatus,
      createdAt: sessionId.split("-")[1] ? new Date(Number(sessionId.split("-")[1])).toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    [sessionId, sourceImage, selectedStyle, note, candidates, providerStatus]
  );

  const standardizeImage = (base64Str: string): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const targetWidth = 1080;
        const targetHeight = 1440;
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(base64Str);
          return;
        }

        ctx.fillStyle = "#05070a";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
        const x = targetWidth / 2 - (img.width * scale) / 2;
        const y = targetHeight / 2 - (img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.src = base64Str;
    });

  const setSource = (image: string, sourceType: "camera" | "upload" | "sample") => {
    setSourceImage(image);
    setCandidates([]);
    setErrorMsg(null);
    setCameraIssue(null);
    setProviderStatus(getGenerationProviderStatus());
    setNote((prev) => ({
      ...prev,
      customerAlias: sourceType === "sample" && !prev.customerAlias ? "샘플 고객" : prev.customerAlias,
      sourceImageSaved: false,
      updatedAt: new Date().toISOString()
    }));
    setAppState(AppState.READY);
  };

  const handleSampleCustomer = () => {
    setSource(createSampleCustomerImage(), "sample");
    setToastMsg("샘플 고객 이미지로 상담을 시작했습니다.");
  };

  const handleCapture = () => {
    cameraRef.current?.triggerCaptureSignal();
    window.setTimeout(() => {
      const frame = cameraRef.current?.captureFrame();
      if (!frame) {
        setCameraIssue("카메라 프레임을 캡처하지 못했습니다. 이미지 업로드나 샘플 고객으로 진행해 주세요.");
        setAppState(AppState.ERROR);
        return;
      }
      setSource(frame, "camera");
    }, 300);
  };

  const handlePhotoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const standardized = await standardizeImage(reader.result as string);
      setSource(standardized, "upload");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleGenerate = async (style = selectedStyle, forceMock = false) => {
    if (!sourceImage) return;

    setErrorMsg(null);
    setProgressText(`${style.nameKo} 후보 3개를 생성 중입니다.`);
    setProviderStatus(forceMock ? "mock_preview" : getGenerationProviderStatus());
    setAppState(AppState.GENERATING);

    try {
      const result = await generateHairStyleCandidates({
        sourceImage,
        style,
        count: 3,
        consultationNote: note.memo,
        forceMock
      });
      setCandidates(result);
      setProviderStatus(result[0]?.metadata.providerStatus ?? (forceMock ? "mock_preview" : getGenerationProviderStatus()));
      setAppState(AppState.RESULTS);
    } catch (error) {
      console.error(error);
      setProviderStatus("generation_failed");
      setErrorMsg("이미지 생성에 실패했습니다. 기존 사진과 선택 스타일은 유지됩니다.");
      setAppState(AppState.ERROR);
    }
  };

  const handleRegenerate = async (candidate: GeneratedCandidate) => {
    if (!sourceImage) return;

    setProgressText(`${candidate.variantLabel}을 다시 생성 중입니다.`);
    setAppState(AppState.GENERATING);

    try {
      const [replacement] = await generateHairStyleCandidates({
        sourceImage,
        style: selectedStyle,
        count: 1,
        consultationNote: note.memo,
        variantStart: candidate.metadata.variantIndex + 3,
        forceMock: candidate.metadata.isMock
      });
      setCandidates((prev) => prev.map((item) => (item.id === candidate.id ? replacement : item)));
      setProviderStatus(replacement.metadata.providerStatus);
      setAppState(AppState.RESULTS);
    } catch (error) {
      console.error(error);
      setProviderStatus("generation_failed");
      setErrorMsg("재생성에 실패했습니다. 기존 후보는 유지됩니다.");
      setAppState(AppState.ERROR);
    }
  };

  const syncSavedCandidate = useCallback((updated: GeneratedCandidate) => {
    setSavedCandidates((prev) => {
      const next = prev.map((candidate) => (candidate.id === updated.id ? { ...updated, savedAt: candidate.savedAt } : candidate));
      writeStoredJson(STORAGE_KEYS.candidates, next);
      return next;
    });
    setSavedReview((prev) => (prev?.id === updated.id ? { ...updated, savedAt: prev.savedAt } : prev));
  }, []);

  const updateCandidate = (candidateId: string, updater: (candidate: GeneratedCandidate) => GeneratedCandidate) => {
    setCandidates((prev) =>
      prev.map((candidate) => {
        if (candidate.id !== candidateId) return candidate;
        const updated = updater(candidate);
        syncSavedCandidate(updated);
        return updated;
      })
    );
  };

  const toggleQuality = (candidateId: string, key: keyof QualityCheck) => {
    updateCandidate(candidateId, (candidate) => ({
      ...candidate,
      qualityCheck: {
        ...candidate.qualityCheck,
        [key]: !candidate.qualityCheck[key]
      }
    }));
  };

  const changeStatus = (candidateId: string, status: CandidateStatus) => {
    updateCandidate(candidateId, (candidate) => ({ ...candidate, status }));
  };

  const downloadCandidate = (candidate: GeneratedCandidate) => {
    const link = document.createElement("a");
    link.href = candidate.image;
    link.download = `hair-twin-${candidate.styleId}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveCandidate = (candidate: GeneratedCandidate) => {
    const saved: GeneratedCandidate = {
      ...candidate,
      sourceImage: note.sourceImageSaved ? sourceImage ?? undefined : undefined,
      savedAt: new Date().toISOString()
    };
    const next = [saved, ...savedCandidates.filter((item) => item.id !== candidate.id)].slice(0, 12);
    setSavedCandidates(next);
    writeStoredJson(STORAGE_KEYS.candidates, next);
    setToastMsg(`${candidate.variantLabel}을 임시 저장했습니다.`);
  };

  const downloadConsultationSummary = () => {
    const payload = {
      ...currentSession,
      sourceImage: note.sourceImageSaved ? sourceImage : "[not saved: no explicit consent]",
      qualitySummary: candidates.map((candidate) => ({
        id: candidate.id,
        styleName: candidate.styleName,
        status: candidate.status,
        checkedCount: Object.values(candidate.qualityCheck).filter(Boolean).length,
        qualityCheck: candidate.qualityCheck,
        provider: candidate.metadata.provider,
        isMock: candidate.metadata.isMock,
        durationMs: candidate.metadata.durationMs
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hair-twin-consultation-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const saveSourceImageConsent = () => {
    setNote((prev) => ({
      ...prev,
      sourceImageSaved: true,
      updatedAt: new Date().toISOString()
    }));
    setToastMsg("원본 사진 저장 동의를 표시했습니다.");
  };

  const resetSession = () => {
    setSessionId(createSessionId());
    setSourceImage(null);
    setCandidates([]);
    setErrorMsg(null);
    setCameraIssue(null);
    setProviderStatus(getGenerationProviderStatus());
    setNote(defaultNote());
    setAppState(AppState.CAPTURE);
  };

  return (
    <div className="app-shell">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden-input"
        onChange={handlePhotoUpload}
      />

      {toastMsg && <div className="toast-message">{toastMsg}</div>}

      <header className="topbar glass-panel">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Scissors size={22} />
          </div>
          <div>
            <h1>Hair Twin</h1>
            <p>AI Salon Consultation Mirror</p>
          </div>
        </div>
        <div className="topbar-status">
          <div className={`provider-chip ${providerStatus}`}>
            <span />
            {providerLabel[providerStatus]}
          </div>
          <div className="state-chip">
            <span className={`state-dot ${isGenerating ? "pulse" : ""}`} />
            {appState === AppState.CAPTURE && "촬영 준비"}
            {appState === AppState.READY && "스타일 선택"}
            {appState === AppState.GENERATING && "AI 생성 중"}
            {appState === AppState.RESULTS && "후보 검토"}
            {appState === AppState.ERROR && "확인 필요"}
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="mirror-stage glass-panel">
          <div className="stage-toolbar">
            <div>
              <span className="section-label">Customer Capture</span>
              <h2>{sourceImage ? "상담 이미지 준비 완료" : "고객 사진 입력"}</h2>
              <p className="stage-subcopy">
                {sourceImage
                  ? "프리셋을 선택하고 상담용 후보 3개를 생성하세요."
                  : "웹캠, 이미지 업로드, 샘플 고객 중 하나로 바로 시작할 수 있습니다."}
              </p>
            </div>
            <div className="toolbar-actions">
              <button type="button" onClick={() => photoInputRef.current?.click()}>
                <Upload size={17} />
                이미지 업로드
              </button>
              <button type="button" onClick={handleSampleCustomer}>
                <UserRound size={17} />
                샘플 고객
              </button>
              <button type="button" onClick={resetSession}>
                <RotateCcw size={17} />
                새 상담
              </button>
            </div>
          </div>

          {(cameraIssue || providerStatus === "api_key_missing") && (
            <div className="inline-guidance">
              {cameraIssue && <p>{cameraIssue}</p>}
              {providerStatus === "api_key_missing" && (
                <p>Gemini API 키가 없어 실제 생성 대신 mock preview로 후보를 확인합니다.</p>
              )}
              <div>
                <button type="button" onClick={() => photoInputRef.current?.click()}>
                  이미지 업로드
                </button>
                <button type="button" onClick={handleSampleCustomer}>
                  샘플 고객으로 시작
                </button>
              </div>
            </div>
          )}

          <div className="capture-surface">
            {!sourceImage ? (
              <CameraFeed
                ref={cameraRef}
                isActive={appState === AppState.CAPTURE || appState === AppState.ERROR}
                onCameraError={(message) => {
                  setCameraIssue(message);
                  setAppState(AppState.ERROR);
                }}
              />
            ) : (
              <img src={sourceImage} alt="고객 원본" className="source-preview" />
            )}
          </div>

          <div className="primary-controls">
            {!sourceImage ? (
              <>
                <button type="button" className="primary-action" onClick={handleCapture}>
                  <Camera size={20} />
                  웹캠 촬영
                </button>
                <button type="button" className="secondary-action" onClick={() => photoInputRef.current?.click()}>
                  <ImagePlus size={20} />
                  파일에서 선택
                </button>
                <button type="button" className="secondary-action" onClick={handleSampleCustomer}>
                  <UserRound size={20} />
                  샘플 고객으로 시작
                </button>
              </>
            ) : (
              <>
                <button type="button" className="primary-action" onClick={() => void handleGenerate()}>
                  <Sparkles size={20} />
                  {selectedStyle.nameKo} 후보 생성
                </button>
                <button type="button" className="secondary-action" onClick={saveSourceImageConsent}>
                  <Save size={20} />
                  원본 저장 동의 표시
                </button>
                <button type="button" className="secondary-action" onClick={downloadConsultationSummary}>
                  <Download size={20} />
                  상담 요약 JSON
                </button>
              </>
            )}
          </div>
        </section>

        <aside className="consultation-panel">
          <section className="glass-panel panel-block">
            <span className="section-label">Style Presets</span>
            <h2>헤어스타일 프리셋</h2>
            <div className="style-grid">
              {HAIR_STYLE_PRESETS.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className={`style-tile ${selectedStyle.id === style.id ? "selected" : ""}`}
                  onClick={() => setSelectedStyle(style)}
                  style={{ "--style-accent": style.accent } as CSSProperties}
                >
                  <span>{style.category}</span>
                  <strong>{style.nameKo}</strong>
                  <small>{style.promptTags.slice(0, 2).join(" · ")}</small>
                </button>
              ))}
            </div>
            <div className="selected-style">
              <span className="section-label">Selected</span>
              <strong>{selectedStyle.nameKo}</strong>
              <p>{selectedStyle.consultationSummary}</p>
              <small>{selectedStyleTags}</small>
            </div>
          </section>

          <section className="glass-panel panel-block">
            <span className="section-label">Consultation Note</span>
            <h2>상담 메모</h2>
            <div className="note-fields">
              <input
                value={note.customerAlias}
                placeholder="고객명 또는 별칭"
                onChange={(event) =>
                  setNote((prev) => ({ ...prev, customerAlias: event.target.value, updatedAt: new Date().toISOString() }))
                }
              />
              <input
                value={note.stylistName}
                placeholder="담당 디자이너"
                onChange={(event) =>
                  setNote((prev) => ({ ...prev, stylistName: event.target.value, updatedAt: new Date().toISOString() }))
                }
              />
              <textarea
                value={note.memo}
                placeholder="현재 모발 상태, 원하는 길이, 피하고 싶은 컬러, 상담 중 나온 코멘트를 남겨주세요."
                onChange={(event) =>
                  setNote((prev) => ({ ...prev, memo: event.target.value, updatedAt: new Date().toISOString() }))
                }
              />
            </div>
            <div className={`consent-row ${note.sourceImageSaved ? "is-saved" : ""}`}>
              {note.sourceImageSaved ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
              원본 사진 저장 동의: {note.sourceImageSaved ? "표시됨" : "아직 없음"}
            </div>
          </section>
        </aside>
      </main>

      {(isGenerating || errorMsg || candidates.length > 0) && (
        <section className="results-dock glass-panel">
          <div className="results-header">
            <div>
              <span className="section-label">Generated Candidates</span>
              <h2>후보 비교</h2>
            </div>
            <div className="compare-toggle" role="group" aria-label="비교 방식">
              <button
                type="button"
                className={compareMode === "side-by-side" ? "active" : ""}
                onClick={() => setCompareMode("side-by-side")}
              >
                전후 비교
              </button>
              <button
                type="button"
                className={compareMode === "result-only" ? "active" : ""}
                onClick={() => setCompareMode("result-only")}
              >
                결과 집중
              </button>
            </div>
          </div>

          {isGenerating && (
            <div className="generation-progress">
              <Loader2 className="spin" size={28} />
              <div>
                <strong>{progressText}</strong>
                <p>얼굴 정체성과 비헤어 영역 보존을 우선하는 상담용 결과를 요청하고 있습니다.</p>
              </div>
            </div>
          )}

          {errorMsg && !isGenerating && (
            <div className="error-banner">
              <XCircle size={18} />
              <span>{errorMsg}</span>
              {sourceImage && (
                <>
                  <button type="button" onClick={() => void handleGenerate()}>
                    다시 시도
                  </button>
                  <button type="button" onClick={() => void handleGenerate(selectedStyle, true)}>
                    Mock으로 보기
                  </button>
                </>
              )}
            </div>
          )}

          {sourceImage && candidates.length > 0 && (
            <div className="candidate-grid">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  sourceImage={sourceImage}
                  compareMode={compareMode}
                  isBusy={isGenerating}
                  onToggleQuality={toggleQuality}
                  onStatusChange={changeStatus}
                  onDownload={downloadCandidate}
                  onSave={saveCandidate}
                  onRegenerate={(item) => void handleRegenerate(item)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {savedCandidates.length > 0 && (
        <section className="saved-strip glass-panel">
          <div>
            <span className="section-label">Temporary Saved</span>
            <strong>임시 저장 {savedCandidates.length}개</strong>
          </div>
          <div className="saved-thumbs">
            {savedCandidates.slice(0, 8).map((candidate) => (
              <button key={candidate.id} type="button" onClick={() => setSavedReview(candidate)} title="저장 결과 다시 보기">
                <img src={candidate.image} alt={`${candidate.styleName} 저장 결과`} />
                <Eye size={14} />
              </button>
            ))}
          </div>
        </section>
      )}

      {savedReview && (
        <div className="saved-review-backdrop" role="dialog" aria-modal="true" aria-label="저장 후보 다시 보기">
          <div className="saved-review glass-panel">
            <button type="button" className="modal-close" onClick={() => setSavedReview(null)} aria-label="닫기">
              <X size={18} />
            </button>
            <div>
              <span className="section-label">Saved Candidate</span>
              <h2>{savedReview.styleName}</h2>
              <p>
                {savedReview.variantLabel} · {savedReview.status === "usable" ? "사용 가능" : savedReview.status === "regenerate" ? "재생성 권장" : "검토 필요"}
              </p>
            </div>
            <img src={savedReview.image} alt={`${savedReview.styleName} 저장 후보`} />
            <div className="saved-review-actions">
              <button type="button" onClick={() => downloadCandidate(savedReview)}>
                <Download size={16} />
                다운로드
              </button>
              <button type="button" onClick={() => setSavedReview(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
