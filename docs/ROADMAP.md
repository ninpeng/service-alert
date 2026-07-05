# Service Alert Roadmap

이 문서는 Service Alert를 로컬 운영툴로 계속 개선하기 위한 작업 목록입니다.
우선순위는 현재 상태 기준입니다.

## 현재 상태

- Next.js 대시보드는 `http://localhost:3333`에서 실행합니다.
- SQLite 데이터는 프로젝트 루트의 `dev.db`를 사용합니다.
- macOS `launchd`로 웹 서버와 worker를 자동 실행하도록 설정했습니다.
- worker는 5분마다 상태 소스를 수집하고, 실행 결과를 `WorkerRun`에 기록합니다.
- Slack webhook이 설정되어 있으면 조건에 맞는 장애 시작/복구 알림이 실제 Slack으로 발송됩니다.

## 1순위: 운영 상태 패널

대시보드에서 앱 자체의 상태를 바로 확인할 수 있게 합니다.

- 웹 서버 실행 상태 표시
- 마지막 worker 실행 시각, 성공/실패 여부, 확인한 provider 수 표시
- 다음 worker 실행 예상 시각 표시
- 최근 worker 에러 메시지 표시
- `logs/web.err.log`, `logs/worker.err.log`에 최근 에러가 있는지 요약

기대 효과:

- 터미널에서 `launchctl`, `tail`, `sqlite3`를 직접 보지 않아도 운영 상태를 판단할 수 있습니다.
- worker가 멈췄거나 실패했을 때 대시보드에서 바로 눈에 띕니다.

## 2순위: 서비스별 제어 UI

현재 DB에는 `enabled`, `slackEnabled` 값이 있지만 대시보드에서 조작할 수 없습니다.
서비스별로 수집과 Slack 알림을 켜고 끌 수 있게 합니다.

- 서비스 수집 활성화/비활성화 토글
- Slack 알림 활성화/비활성화 토글
- 변경 이력 또는 마지막 변경 시각 표시
- 토글 변경 후 다음 worker 실행부터 반영

주의할 점:

- 실수로 전체 알림이 꺼지지 않도록 확인 UI가 필요합니다.
- 저장 실패 시 이전 상태로 되돌리고 에러를 보여줘야 합니다.

## 3순위: 알림 정책 개선

Slack 발송 조건을 더 세밀하게 조정합니다.

- 서비스별 `minor` incident 알림 허용 여부
- AWS 리전 필터를 설정으로 관리
- 조용한 시간대에는 Slack 발송을 보류하거나 요약으로 전환
- 동일 incident의 반복 업데이트를 일정 시간 묶어서 중복 발송 방지

주의할 점:

- 알림 정책은 복잡해지기 쉬우므로 기본값은 현재 정책을 유지합니다.
- 실제 Slack 발송 전에는 테스트 webhook 또는 dry-run 모드가 있으면 좋습니다.

## 4순위: 데이터 관리

장기간 운영할 때 DB가 너무 커지지 않게 관리합니다.

- 오래된 `WorkerRun` 정리 정책
- 오래된 resolved incident 보관 기간 설정
- notification event 보관 기간 설정
- 수동 백업/복구 명령 문서화

## 5순위: 설치와 자동 실행 정리

새 Mac에서 더 쉽게 복구할 수 있게 합니다.

- 현재 Mac용 launchd 설정 절차를 README에 보강
- `node`, `pnpm`, `corepack` 경로 확인 체크리스트 추가
- Node 버전 변경 시 native dependency 재빌드 절차 추가
- `Watchpack EMFILE`이 날 때의 dev server 우회 방법 기록

## 6순위: 상태 상세와 검색

서비스별 incident와 component가 많아지면 현재 화면만으로는 과거 상황을 찾기 어렵습니다.
대시보드에서 필요한 기록을 빠르게 찾을 수 있게 합니다.

- 서비스별 incident 전체 보기
- incident 상태, impact, 기간 기준 필터
- resolved incident와 active incident 분리
- 제목과 provider 이름 검색
- incident 원문 링크와 마지막 수집 시각 강조

기대 효과:

- "지난번 JIRA 장애 언제였지?" 같은 질문에 바로 답할 수 있습니다.
- Slack 알림이 왜 발송됐는지 UI에서 추적하기 쉬워집니다.

## 7순위: 수동 작업 버튼

운영 중 자주 쓰는 명령을 대시보드에서 안전하게 실행할 수 있게 합니다.

- `worker:check` 수동 실행 버튼
- 최근 로그 새로고침 버튼
- worker 실행 중에는 중복 실행 방지
- 실행 결과를 toast 또는 상단 상태 영역에 표시
- 실패 시 에러 로그 위치 안내

주의할 점:

- 버튼 클릭이 실제 Slack 발송으로 이어질 수 있으므로, Slack webhook이 설정된 경우에는 확인 UI가 필요합니다.
- Next.js API route에서 장시간 worker를 실행할 때 timeout과 중복 실행 처리를 조심해야 합니다.

## 8순위: 알림 dry-run과 테스트 발송

Slack 설정을 바꿀 때 실제 운영 채널에 잘못 보내지 않도록 검증 모드를 둡니다.

- Slack webhook 연결 테스트
- 특정 incident를 선택해 메시지 미리보기
- dry-run worker 실행 모드
- 실제 발송 없이 `NotificationEvent`에 `skipped` 또는 `dry_run` 기록
- 테스트 채널 webhook과 운영 채널 webhook 분리

기대 효과:

- 알림 정책을 바꾸기 전에 메시지 형태와 발송 조건을 확인할 수 있습니다.
- 새 Mac으로 옮긴 뒤 Slack 연동 상태를 안전하게 검증할 수 있습니다.

## 9순위: 설정 파일과 DB 설정 분리

현재 주요 provider 목록은 코드에 있고, 일부 설정은 DB와 `.env`에 나뉘어 있습니다.
운영자가 바꿔야 하는 값과 코드 변경이 필요한 값을 분리합니다.

- provider endpoint와 알림 여부를 DB 또는 별도 config로 관리
- AWS 알림 대상 리전을 설정으로 분리
- `.env` 필수 값 검증
- 설정 화면 또는 설정 검증 CLI 추가
- 잘못된 endpoint나 webhook URL을 시작 시점에 경고

주의할 점:

- 너무 많은 설정을 UI로 빼면 복잡해지므로, 먼저 운영 중 자주 바뀌는 값만 대상으로 합니다.
- Slack webhook 같은 민감 값은 화면에 그대로 노출하지 않습니다.

## 10순위: 데이터 백업과 내보내기

로컬 SQLite를 쓰기 때문에, 백업과 이전 절차를 명확하게 만들어야 합니다.

- `dev.db` 백업 명령 문서화
- 날짜가 붙은 백업 파일 생성 스크립트
- incident와 notification event를 CSV 또는 JSON으로 export
- 새 Mac 이전 체크리스트
- 백업 파일에서 복구하는 절차 문서화

기대 효과:

- Mac 교체나 DB 손상 시 복구가 쉬워집니다.
- 장애 기록을 다른 문서나 리포트에 옮기기 편해집니다.

## 11순위: 상태 요약 리포트

매일 또는 매주 상태 요약을 남길 수 있게 합니다.

- 최근 24시간 또는 7일 incident 요약
- provider별 장애 건수와 누적 영향 시간
- Slack 발송/실패/스킵 건수
- worker 성공률
- Markdown 리포트 생성 또는 Slack 요약 발송

주의할 점:

- 정확한 영향 시간 계산은 provider별 status 표현이 달라 오차가 생길 수 있습니다.
- 처음에는 "기록된 startedAt/resolvedAt 기준"처럼 단순한 기준으로 시작하는 편이 좋습니다.

## 12순위: 장애 분류와 메모

외부 상태 소스가 준 정보에 내부 판단을 덧붙일 수 있게 합니다.

- incident에 내부 메모 추가
- "우리 서비스 영향 있음/없음" 표시
- 후속 조치 링크 추가
- 같은 provider의 반복 장애에 태그 추가
- 해결 후 회고 메모 연결

기대 효과:

- 외부 incident와 내부 영향도를 분리해 볼 수 있습니다.
- 나중에 비슷한 장애가 생겼을 때 과거 판단 근거를 찾기 쉽습니다.

## 13순위: 화면 사용성 개선

대시보드를 오래 띄워놓고 볼 때 필요한 작은 편의 기능을 추가합니다.

- compact view와 comfortable view 전환
- 어두운 모드
- critical/major incident 시 화면 상단 고정 배너
- 자동 갱신 일시정지
- 모바일 화면에서 테이블 대신 카드형 목록 제공

기대 효과:

- 모니터에 띄워두는 운영 화면과 노트북에서 확인하는 화면을 모두 편하게 쓸 수 있습니다.

## 14순위: provider 추가 구조 정리

새 상태 소스를 추가할 때 반복 작업을 줄입니다.

- provider adapter 테스트 템플릿
- Statuspage 기반 provider 추가 가이드
- RSS 기반 provider 추가 가이드
- provider별 fixture 관리
- provider 파서 실패 시 어떤 payload가 문제였는지 추적

기대 효과:

- GitHub, Cloudflare, OpenAI 같은 새 provider를 붙일 때 작업량이 줄어듭니다.
- 파서 변경 시 기존 provider 회귀를 막기 쉽습니다.

## 15순위: 보안과 민감 정보 보호

로컬 도구라도 webhook과 운영 기록을 다루므로 기본 안전장치를 둡니다.

- `.env`와 `dev.db`가 git에 올라가지 않는지 검증
- Slack webhook 값 마스킹 표시
- 로그에 webhook URL이 찍히지 않도록 테스트
- API route가 민감 설정을 반환하지 않는지 확인
- 외부 접속을 열 경우 인증 또는 localhost 제한 검토

주의할 점:

- 지금은 로컬 운영툴이므로 인증 기능을 바로 넣기보다는, 외부 노출 가능성이 생길 때 우선순위를 올립니다.

## 빠른 개선 후보

시간이 적게 들고 체감이 있는 작업입니다.

- worker stderr의 `DEP0205` warning 원인과 영향 정리
- `/api/dashboard` 응답에 `lastWorkerRun` 요약 필드 추가
- 대시보드에 "Slack webhook 설정됨/비어 있음" 상태만 마스킹해서 표시
- logs 디렉터리가 없을 때 자동 생성하는 setup 명령 추가

## 검증 체크리스트

변경 작업을 할 때마다 아래 명령으로 확인합니다.

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

운영 상태는 아래 명령으로 확인합니다.

```sh
launchctl print gui/$(id -u)/com.service-alert.web
launchctl print gui/$(id -u)/com.service-alert.worker
curl -I http://localhost:3333/
curl -I http://localhost:3333/api/dashboard
tail -n 40 logs/web.err.log
tail -n 40 logs/worker.out.log
tail -n 40 logs/worker.err.log
```
