# AI Provider Monitoring Design

Date: 2026-07-10
Status: Approved for planning

## Goal

Add three monitored services without changing the dashboard layout or database schema:

- OpenAI: monitor general user and developer products, including ChatGPT, APIs, and Codex.
- Claude: monitor general user and developer products, including claude.ai, Console, API, Claude Code, and Cowork.
- Gemini: monitor only the Gemini web and app service.

After the next worker run, the dashboard should contain ten monitored services instead of seven.

## Non-goals

- Google Workspace products such as Gmail, Drive, Calendar, or Meet
- Google Cloud, Vertex AI, or the Vertex Gemini API
- Synthetic requests against authenticated AI APIs
- Per-component enable and Slack controls
- A Prisma schema migration
- Monitoring government-only or advertising-only product surfaces

## Chosen Approach

Represent each company as one `MonitoredService` and keep its products as service components. This matches the existing provider snapshot model and prevents one upstream incident from producing duplicate service rows and Slack notifications.

OpenAI and Claude use the existing Statuspage adapter with explicit exclusions. Gemini uses a dedicated Google Workspace adapter because its public JSON format is not compatible with Statuspage.

New general OpenAI and Claude components are included automatically. Only explicitly configured special-purpose components are excluded.

## Provider Configuration

| Service | Provider ID | Provider kind | Public source | Filter |
| --- | --- | --- | --- | --- |
| OpenAI | `openai` | `statuspage` | `https://status.openai.com/api/v2/summary.json` | Exclude `FedRAMP`, `Ads Manager`, and `Ads API` |
| Claude | `claude` | `statuspage` | `https://status.claude.com/api/v2/summary.json` | Exclude `Claude for Government` |
| Gemini | `gemini` | `google-workspace` | `https://www.google.com/appsstatus/dashboard/incidents.json` | Include only `service_name === "Gemini"` |

`ProviderId` gains `openai`, `claude`, and `gemini`. `ProviderKind` gains `google-workspace`.

`MonitoredServiceConfig` gains two optional source filtering fields:

- `excludedComponentNames?: readonly string[]` for Statuspage sources
- `sourceServiceName?: string` for Google Workspace sources

These values remain code-owned defaults; they are not stored in new database columns.

## Statuspage Filtering

The Statuspage adapter accepts an optional excluded component-name set.

When exclusions are configured, it performs these steps:

1. Match excluded names against the top-level component list and build an excluded component-ID set.
2. Remove those components from the normalized component list.
3. Keep an incident when it has no component metadata, because it may be provider-wide.
4. Keep an incident when it references an unknown component ID or at least one retained component.
5. Drop an incident only when every referenced component ID is in the excluded set.
6. Recalculate the overall status from retained component states and retained incident impacts so an excluded outage cannot degrade the service card.

Component states map to the dashboard as follows:

| Source state | Overall status |
| --- | --- |
| `operational` | `none` |
| `degraded_performance` | `minor` |
| `partial_outage` | `major` |
| `major_outage` | `critical` |

Incident impacts use the existing `minor`, `major`, and `critical` ordering. The most severe retained component or incident determines the result.

Existing Statuspage providers without exclusions continue using the source page's current overall indicator. This avoids changing JIRA, Bitbucket, Vercel, Notion, and Figma behavior as part of this feature.

## Gemini Adapter

The Google Workspace endpoint returns incident history rather than a current Statuspage summary. The adapter normalizes only incidents that satisfy both conditions:

- `service_name` exactly equals `Gemini`.
- The incident is still active: it has no `end` timestamp and its latest update is not `AVAILABLE`.

Resolved history is intentionally omitted. This prevents old Gemini incidents from generating notifications during the first worker run. An incident previously stored by Service Alert is resolved through the existing missing-incident resolution flow once it disappears from the active set.

The adapter produces one Gemini component. It is `operational` with no active incident; otherwise its state and the provider overall status are derived from the highest active incident severity.

Each active incident is normalized as follows:

| Normalized field | Google Workspace field |
| --- | --- |
| `externalId` | `id` |
| `title` | Title section from `external_desc`, with a stable Gemini fallback |
| `status` | `most_recent_update.status` |
| `impact` | Mapped from `severity` |
| `url` | `uri` resolved against the Workspace dashboard base URL |
| `startedAt` | `begin` |
| `updatedAt` | `modified` |
| `resolvedAt` | `null` while returned as active |
| `isMaintenance` | `false` |
| `shouldNotify` | `true` |
| `raw` | Original incident object |

Gemini severity maps to normalized impact and component state as follows:

| Gemini severity | Impact | Component state | Overall status |
| --- | --- | --- | --- |
| `low` | `minor` | `degraded_performance` | `minor` |
| `medium` | `major` | `partial_outage` | `major` |
| `high` or `critical` | `critical` | `major_outage` | `critical` |

Unknown or malformed severity values produce a `null` incident impact and `unknown` component and overall status rather than silently reporting healthy. Missing required identifiers or invalid top-level JSON cause a provider-specific collection error.

## Data Flow

1. `ensureDefaultServices` inserts the three new defaults when they are absent.
2. The worker loads all enabled services as it does today.
3. `fetchProviderSnapshot` dispatches OpenAI and Claude to Statuspage and Gemini to the Google Workspace adapter.
4. Each adapter returns the existing `ProviderSnapshot` shape.
5. Existing persistence upserts components and active incidents.
6. Existing missing-incident handling records recovery when an active incident disappears.
7. The worker identifies incidents that are new to the local database so their first observation is classified as `incident_started`, even when the provider has already published later updates.
8. Existing notification deduplication sends each eligible incident start and recovery at most once per dedupe key. Intermediate incident updates remain persisted but are not Slack-sent under the current notification policy.
9. The existing dashboard renders the three additional service cards without a new UI path.

## Failure Behavior

- One provider failure does not stop other providers from being checked.
- A mixed successful and failed run is recorded as `PARTIAL_FAILURE`.
- A failed provider keeps its last successfully persisted data.
- Fetch and parse failures include the service name in the error reported through `WorkerRun.errorMessage`.
- No endpoint requires an API key, login, or additional secret.
- If an incident is already active when the feature is deployed, its initial database observation produces one normal incident-start notification even when its source `updatedAt` differs from `startedAt`.

## Testing

Add focused tests for:

- Default configuration and seeding of OpenAI, Claude, and Gemini
- Statuspage component exclusion by exact name
- Incidents affecting only excluded components
- Provider-wide incidents with no component metadata
- Overall status recalculation after exclusions
- Preservation of existing Statuspage behavior when no filter is configured
- Gemini service-name filtering
- Gemini active and resolved incident selection
- Gemini field, severity, status, date, and URL normalization
- Malformed Google Workspace payload errors
- First-observation notification classification for an already-updated active incident
- Worker persistence, notification deduplication, and missing-incident recovery for a new provider

Run the repository verification suite after implementation:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Acceptance Criteria

- With all defaults enabled, a successful worker run checks ten providers.
- OpenAI, Claude, and Gemini appear as separate dashboard service cards.
- OpenAI general products and Claude general products are visible as components.
- FedRAMP, OpenAI advertising products, and Claude for Government are absent and cannot affect overall status or Slack notifications.
- Gemini incidents unrelated to the Gemini web and app service are ignored.
- Historical resolved Gemini incidents do not generate first-run notifications.
- Eligible active-incident start and recovery notifications use the existing dedupe behavior; intermediate updates remain persisted without Slack delivery.
- Existing seven providers retain their current parsing and notification behavior.
