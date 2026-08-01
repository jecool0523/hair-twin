# Hair Twin 실제 AI 로컬 시연 런북

이 문서는 비개인 합성 이미지로 **새 staging Supabase + 실제 OpenAI Images + worker-local CV**를 한 번 검증하는 절차다. Production 및 실제 고객 데이터는 금지한다. 기존 외부 프로젝트는 재사용하거나 변경하지 않는다.

## 고정된 기술 선택

- 이미지 편집 API: `POST /v1/images/edits`
- 권장 모델: `gpt-image-2-2026-04-21` (승인 체크포인트에서 최종 확정)
- quality: `medium`
- size: `source`; worker가 원본의 실제 `WIDTHxHEIGHT`로 변환한다.
- 후보/HTTP 예산 기본값: 후보 1개, retry 0, process당 최대 HTTP 시도 1회
- CV runtime: `opencv-python-headless==4.13.0.92` (Apache-2.0), `numpy==2.5.1`
- 얼굴/landmark: YuNet `face_detection_yunet_2023mar.onnx` (MIT)
- identity embedding: SFace `face_recognition_sface_2021dec.onnx` (Apache-2.0)

모델은 Docker 빌드 중 공식 OpenCV Zoo URL에서만 받고 아래 SHA-256으로 검증한다. 바이너리는 Git에 저장하지 않는다.

- YuNet: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
- SFace: `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`

## 실제 측정값

`local_cv`는 source/candidate/mask bytes를 child process 메모리에서만 처리하며 이미지나 embedding을 별도 저장·전송·로그하지 않는다.

- `face_count`: YuNet이 후보에서 검출한 얼굴 수. 원본 또는 후보가 정확히 한 명이 아니면 hard fail이다.
- `identity_similarity`: SFace cosine similarity `[-1,1]`를 `[0,1]`로 정규화한 값이다.
- `landmark_delta`: 각 face box 안에서 정규화한 YuNet 5개 landmark 좌표의 RMS 차이다.
- `non_hair_diff`: source와 candidate의 hair mask 밖 평균 절대 픽셀 차이를 `[0,1]`로 정규화한 값이다.
- `hair_coverage_ratio`: 실제 binary edit mask의 전체 이미지 대비 비율이다.
- `realism_score`: YuNet 얼굴 confidence 50%, source 대비 candidate 선명도 보존 30%, 과다 노출/암부 clipping 회피 20%로 계산한 기술적 이미지 품질 점수다. 미학적 주관 점수가 아니다.
- `style_match`: mask 안 픽셀 변화에서 mask 밖 변화를 뺀 hair-localized edit adherence를 `[0,1]`로 정규화한 값이다. 특정 헤어스타일 의미를 완전히 판별하는 점수는 아니므로 미용사 검토를 대체하지 않는다.

TypeScript와 Python은 같은 임계값을 사용한다. NaN, Infinity, 범위 밖 수치, 잘못된 face count, dimension 불일치, decode/model 오류, timeout은 `blocked_policy_or_safety` 또는 fail-closed 측정 실패로 고객 공개를 차단한다. `accepted`와 `needs_stylist_review`도 미용사의 명시적 `usable` 판정 전에는 고객에게 보이지 않으며, hard-fail/regenerate는 `usable`로 강제 승인할 수 없다.

## 비밀값과 환경 구분

Browser-safe(Vercel Preview/승인된 staging scope):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Web server secret store:

- `SUPABASE_SECRET_KEY`
- `MEDIA_TOKEN_SECRET`
- `CRON_SECRET`

Worker secret store:

- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`

Worker non-secret configuration:

```text
HAIR_TWIN_PROVIDER=openai
HAIR_TWIN_ALLOW_MOCK=false
HAIR_TWIN_ENABLE_EXTERNAL_AI=true
HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT=true
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
OPENAI_IMAGE_QUALITY=medium
OPENAI_IMAGE_SIZE=source
OPENAI_IMAGE_MAX_CALLS_PER_PROCESS=1
OPENAI_IMAGE_MAX_RETRIES=0
OPENAI_IMAGE_MAX_CANDIDATES_PER_JOB=1
HAIR_TWIN_CV_PROVIDER=local_cv
HAIR_TWIN_CV_TIMEOUT_SECONDS=30
HAIR_TWIN_CV_MAX_IMAGE_BYTES=20971520
HAIR_TWIN_CV_MODEL_DIR=/app/models
```

비밀값은 파일, 명령 기록, 채팅, 문서, 로그에 출력하지 않는다. 각 host의 secret 입력 UI나 비대화형 secret store를 사용한다.

## 유료 호출 전 보고 체크포인트

다음 항목을 한 번에 보고한다. 비개인 이미지 1장, 후보 1개, HTTP 시도
1회, retry 0, worker replica 1개, staging 범위는 2026-08-01 정책으로
사전 승인되었으므로 이 범위 안에서는 다시 승인 질문을 하지 않는다.

1. 정확한 모델/snapshot, quality, 실제 원본 dimensions
2. 후보 수 1, 최대 HTTP 시도 1, worker replica 1
3. 공식 가격 URL과 이미지 입력+출력의 최소/최대 예상 비용
4. 사용할 합성 이미지의 파일명과 SHA-256(이미지 자체나 경로를 로그에 남기지 않음)
5. 이미지 전송 대상이 OpenAI뿐이고 CV는 worker 내부 로컬 처리임
6. source/mask/generated object가 private Storage에 저장되는 기간과 시연 후 discard/purge 절차

보고 전에는 `OPENAI_IMAGE_MAX_CALLS_PER_PROCESS=0`과 외부 AI gate `false`를
유지한다. 두 번째 호출, retry, 후보/replica 증가, 다른 모델·quality·size,
실제 고객 이미지, staging 이외 환경, 외부 CV 전송은 별도 승인을 받는다.

## 로컬 시연 순서

1. 새 Seoul Supabase `hair-twin-staging`에 기존 forward migrations/test seed를 적용한다. reset이나 데이터 삭제 명령은 사용하지 않는다.
2. 새 Vercel `hair-twin-staging`과 Railway `hair-twin-staging`/`hair-twin-ai-worker-staging`을 연결한다. web은 `HAIR_TWIN_STORE=supabase`, worker는 먼저 mock으로 실행해 Auth/PostgREST/Storage/queue를 재확인한다.
3. Docker worker의 `/healthz`, `/readyz`, `/metrics`를 확인한다.
4. 승인된 합성 성인 portrait를 1024x1024 PNG로 준비한다. 저장소의 `.hair-twin-demo/`는 Git ignore 대상이다.
5. 유료 호출 체크포인트를 보고한 후 위 실제 worker 설정으로 replica 1개를 시작한다.
6. 직원 로그인 → 상담 → 동의 → upload → hair mask 확인 → 스타일 → 후보 1개 job을 만든다.
7. worker가 1회 edit, private upload, `local_cv`, DB QC 저장을 완료하는지 확인한다.
8. hard fail이면 고객 비노출을 확인한다. approvable이면 미용사가 `usable`로 승인한 후에만 고객 화면과 저장 대상에 나타나는지 확인한다.
9. 로그아웃 접근 거부, console/failed request, mobile/desktop을 확인한다.
10. 저장이 불필요하면 상담의 discard 흐름으로 자산을 만료시키고 retention sweep으로 제거한다. DB/Storage를 수동 삭제하지 않는다.

## Worker 재시작과 보존

DB claim/lock RPC가 lifecycle의 소유자다. replica는 유료 테스트 동안 1개로 고정하고, 비정상 종료 후에는 기존 job 상태와 HTTP 예산이 process-local이라는 점을 확인한 뒤 새 유료 호출을 자동 재개하지 않는다. process 재시작 전 `OPENAI_IMAGE_MAX_CALLS_PER_PROCESS=0`으로 닫고 새 승인을 받아야 한다.

결과 자산은 private bucket에만 저장되고 기존 retention 정책을 따른다. 실제 provider 원문 응답과 signed URL은 저장하지 않는다. QC `signals` JSON에는 수치와 scorer/model/measured/duration/failure code만 저장한다.

## 외부 리소스 기록 항목

- 새 GitHub `jecool0523/hair-twin` URL과 `main` SHA
- 새 Supabase `hair-twin-staging` project ref(Seoul)
- 새 Vercel `hair-twin-staging` Preview URL
- 새 Railway `hair-twin-staging`/`hair-twin-ai-worker-staging` URL과 비용 상한
- 실제 유료 호출 횟수와 공식 가격 기준 실제/추정 비용
- production 전환 시 개인정보 문구, 예산, backup/recovery, domain, 운영 담당자에 대한 별도 승인
