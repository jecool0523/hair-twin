# Hair Twin MVP

Hair Twin MVP는 기존 Magic Mirror Try-On 구조를 기반으로 만든 미용실 상담용 AI 헤어스타일 시뮬레이션 앱입니다. 고객 사진을 웹캠 촬영 또는 이미지 업로드로 입력하고, 헤어스타일 프리셋을 선택해 GPT Images 기반 후보 이미지를 생성합니다.

## Live Demo

- Production: https://hair-twin-mvp.vercel.app
- GitHub: https://github.com/jecool0523/try-on
- App directory: `hair-twin-mvp/`

## 주요 기능

- 웹캠 촬영 또는 이미지 업로드
- 샘플 고객 이미지로 빠른 데모 시작
- 약 10개 헤어스타일 프리셋 제공
- 스타일 선택 후 후보 이미지 3개 생성
- 원본/결과 전후 비교
- 후보별 품질 체크리스트
- 후보 상태 관리: 검토 필요, 사용 가능, 재생성 권장
- 결과 다운로드
- 임시 저장 및 저장 후보 다시 보기
- 상담 메모 저장
- 상담 요약 JSON 다운로드
- UI에서 OpenAI API 키 입력 가능

## 기술 스택

- React
- TypeScript
- Vite
- Vercel Serverless Functions
- OpenAI GPT Images API
- localStorage 기반 임시 저장

## 프로젝트 구조

```text
hair-twin-mvp/
  api/
    hair-twin/
      generate-image.ts      # Vercel production용 GPT Images API route
  public/
    favicon.svg
  src/
    components/              # Camera, candidate card, quality checklist
    services/
      generationService.ts   # mock/OpenAI generation provider
      storage.ts
    App.tsx                  # MVP 화면과 상태 흐름
    constants.ts             # 헤어 프리셋, storage key, QC labels
    types.ts                 # Hair Twin domain types
  vite.config.ts             # Vite 설정 및 local dev API middleware
```

## 로컬 실행

```powershell
cd C:\Users\seocheon\Documents\헤어트윈\hair-twin-mvp
npm.cmd install
npm.cmd run dev -- --host 0.0.0.0 --port 3001
```

브라우저에서 `http://localhost:3001/`로 접속합니다.

## OpenAI API 키 설정

앱 우측의 `API Settings / GPT Images 연결` 패널에서 OpenAI API 키를 입력할 수 있습니다.

- 키를 입력하고 `설정 적용`을 누르면 현재 세션에서 사용됩니다.
- `이 브라우저에 키 저장`을 체크하면 localStorage에 저장됩니다.
- 공용 PC나 고객 테스트 환경에서는 키 저장 체크를 끄는 것을 권장합니다.
- `키 삭제` 버튼으로 브라우저에 저장된 키를 삭제할 수 있습니다.

로컬 또는 Vercel 환경변수로도 설정할 수 있습니다.

```env
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=medium
VITE_FORCE_MOCK_GENERATION=false
```

## 이미지 생성 흐름

1. 사용자가 고객 사진을 촬영하거나 업로드합니다.
2. 헤어스타일 프리셋을 선택합니다.
3. `generateHairStyleCandidates`가 후보 3개 생성을 요청합니다.
4. 브라우저는 `/api/hair-twin/generate-image`로 원본 이미지, 프롬프트, API 설정을 전달합니다.
5. Vercel API route가 OpenAI Images Edit API를 호출합니다.
6. 결과 이미지는 후보 카드에 표시되고, 품질 체크/저장/다운로드가 가능합니다.

프롬프트는 다음 원칙을 포함합니다.

- 고객의 얼굴 정체성 유지
- 얼굴 구조, 피부톤, 표정 유지
- 의상, 배경, 몸 변경 금지
- 변경 대상은 헤어스타일, 길이, 컬러, 볼륨, 질감으로 제한
- 실제 미용 상담용 결과처럼 자연스럽게 생성

## Mock 모드

실제 API 호출 없이 상담 흐름을 테스트하려면 `.env.local` 또는 Vercel 환경변수에 다음 값을 설정합니다.

```env
VITE_FORCE_MOCK_GENERATION=true
```

Mock 모드는 canvas 기반 미리보기 이미지를 생성합니다. 실제 AI 품질 검증용은 아니며, MVP 상담 플로우 테스트용입니다.

## 빌드

```powershell
cd C:\Users\seocheon\Documents\헤어트윈\hair-twin-mvp
npm.cmd run build
```

빌드 산출물은 `hair-twin-mvp/dist/`에 생성됩니다.

## 배포

현재 Vercel 프로젝트:

- Project: `hair-twin-mvp`
- Team: `je-cools-projects`
- Production URL: https://hair-twin-mvp.vercel.app

수동 배포:

```powershell
cd C:\Users\seocheon\Documents\헤어트윈\hair-twin-mvp
npx.cmd --yes vercel@latest deploy --prod --yes --scope je-cools-projects
```

## 보안 주의사항

현재 MVP는 빠른 테스트를 위해 브라우저 UI에서 OpenAI API 키를 입력할 수 있습니다. 이 방식은 로컬/데모 테스트에는 편하지만, 실제 고객 사진을 다루는 운영 환경에는 충분하지 않습니다.

운영 전에는 다음을 보완해야 합니다.

- API 키를 서버 환경변수로만 관리
- 사용자 인증 추가
- 요청 rate limit 추가
- 고객 사진 저장/삭제 정책 명확화
- 상담 데이터 DB 저장 시 암호화와 접근 제어 적용
- 이미지 생성 로그와 비용 모니터링 추가

## 현재 한계

- 품질 체크는 자동 판정이 아니라 미용사가 수동으로 체크합니다.
- 얼굴 보존 여부는 자동 검증하지 않습니다.
- 저장은 localStorage 기반 임시 저장입니다.
- 고객 원본 사진은 명시적 저장 동의 상태일 때만 상담 요약에 포함됩니다.
- GPT Images 결과 품질은 입력 사진, 프롬프트, 계정 권한/쿼터에 영향을 받습니다.
