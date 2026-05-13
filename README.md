# Service Alert

JIRA, Bitbucket, Slack, Vercel, AWS, Notion, Figma의 공식 상태 소스를 주기적으로 수집하는 로컬 운영툴입니다.

Next.js 대시보드에서 현재 서비스 상태, 최근 incident, Slack 발송 이력, worker 실행 결과를 확인합니다. macOS에서는 `launchd`로 웹 서버와 worker를 자동 실행할 수 있습니다.

## 주요 동작

- 대시보드 포트: `3333`
- 데이터 저장소: SQLite `dev.db`
- 상태 수집: provider 공식 Status API 또는 RSS polling
- 브라우저 자동 갱신: 60초마다 화면 데이터 갱신
- worker 기본 주기: launchd 기준 5분마다 실행
- Slack 알림: `major` 또는 `critical` incident의 `장애 시작`, `복구`만 발송
- Slack 미발송: `minor`, `장애 업데이트`, 예정 점검
- 예정 점검: DB/UI에는 저장하지만 Slack으로 보내지 않음

## 설치

```sh
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm db:seed
```

`.env`에는 최소 다음 값을 설정합니다.

```env
DATABASE_URL="file:./dev.db"
SLACK_WEBHOOK_URL=""
PORT="3333"
```

`SLACK_WEBHOOK_URL`이 없으면 Slack 발송은 하지 않고, 알림 이벤트는 `skipped` 상태로 기록합니다.

## 실행

개발 서버:

```sh
pnpm dev
```

프로덕션 실행:

```sh
pnpm build
pnpm start
```

대시보드는 아래 주소에서 확인합니다.

```text
http://localhost:3333
```

대시보드와 같은 데이터를 JSON으로 보려면:

```text
http://localhost:3333/api/dashboard
```

worker를 수동 실행하려면:

```sh
pnpm worker:check
```

주의: Slack webhook이 설정되어 있고 조건에 맞는 새 알림이 있으면 실제 Slack 메시지가 발송될 수 있습니다.

## launchd 자동 실행

예시 plist는 `launchd/` 디렉터리에 있습니다.

```sh
mkdir -p ~/Library/LaunchAgents
cp launchd/com.service-alert.web.plist.example ~/Library/LaunchAgents/com.service-alert.web.plist
cp launchd/com.service-alert.worker.plist.example ~/Library/LaunchAgents/com.service-alert.worker.plist
```

새 PC나 다른 경로에서 사용할 때는 plist 안의 값을 먼저 확인합니다.

- `WorkingDirectory`
- `DATABASE_URL`
- `SLACK_WEBHOOK_URL`
- `PORT`
- `StandardOutPath`
- `StandardErrorPath`

로드:

```sh
launchctl load ~/Library/LaunchAgents/com.service-alert.web.plist
launchctl load ~/Library/LaunchAgents/com.service-alert.worker.plist
```

언로드:

```sh
launchctl unload ~/Library/LaunchAgents/com.service-alert.web.plist
launchctl unload ~/Library/LaunchAgents/com.service-alert.worker.plist
```

로컬 Mac이 꺼져 있거나 sleep 상태면 worker도 실행되지 않습니다.

## 새 환경에서 실행하기

권장 방식은 소스를 옮긴 뒤 새 PC에서 다시 설치/빌드하는 것입니다.

```sh
git clone <repo-url> service-alert
cd service-alert
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm build
pnpm start
```

기존 이력까지 옮기려면 현재 PC의 `dev.db`를 새 PC의 프로젝트 루트로 복사합니다. 이 경우 `pnpm db:seed`는 다시 실행하지 않아도 됩니다.

`.env`, `dev.db`, Slack webhook URL은 git에 올리지 않습니다. 새 PC에는 별도로 복사하거나 다시 설정합니다.

## 상태 소스

- JIRA: `https://jira-software.status.atlassian.com/api/v2/summary.json`
- Bitbucket: `https://status.bitbucket.org/api/v2/summary.json`
- Slack: `https://slack-status.com/api/v2.0.0/current`
- Vercel: `https://www.vercel-status.com/api/v2/summary.json`
- AWS: `https://status.aws.amazon.com/rss/all.rss`
- Notion: `https://www.notion-status.com/api/v2/summary.json`
- Figma: `https://status.figma.com/api/v2/summary.json`

AWS Slack 알림은 다음 리전에 매칭되는 이벤트만 대상으로 합니다.

- `ap-northeast-2`
- `us-east-1`
- `us-east-2`
- `us-west-1`
- `us-west-2`

## 검증

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
