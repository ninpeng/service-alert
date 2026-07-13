# Didit Monitoring Design

Date: 2026-07-13
Status: Approved for planning

## Goal

Add Didit as one monitored service with all three components currently published on its public status page:

- Core APIs
- Business Console
- Hosted Verification Web App

After the next worker run, the dashboard should contain eleven monitored services instead of ten.

## Non-goals

- Synthetic requests against Didit product APIs
- Authentication with Didit or incident.io
- Scraping Next.js implementation details from the rendered status page
- Per-component enable or Slack controls
- A Prisma schema migration
- Dashboard layout changes

## Chosen Approach

Poll Didit's official incident.io RSS feed at `https://status.didit.me/feed.rss`.

Didit's public page has the incident.io Widget JSON API disabled, while the RSS feed is public and structured. Parsing the RSS feed avoids coupling the monitor to the status page's rendered HTML and Next.js deployment artifacts. Direct health checks against product endpoints are not used because they would measure reachability rather than Didit's published incident state.

The existing `fast-xml-parser` dependency parses both the RSS document and the HTML-shaped XML fragment carried in each item's CDATA description. No new dependency is required.

## Provider Configuration

Add `didit` to `ProviderId` and `incidentio-rss` to `ProviderKind`.

The default service uses this configuration:

| Field | Value |
| --- | --- |
| Name | `Didit` |
| Provider ID | `didit` |
| Provider kind | `incidentio-rss` |
| Endpoint | `https://status.didit.me/feed.rss` |
| Components | `Core APIs`, `Business Console`, `Hosted Verification Web App` |
| Enabled | `true` |
| Slack enabled | `true` |

`MonitoredServiceConfig` gains an optional `sourceComponentNames` list. It remains code-owned configuration and is not stored in a new database column.

## RSS Normalization

The adapter parses each RSS item from `rss.channel.item`. Required incident identity comes from `guid`, falling back to `link` only when needed. The item title, link, publication date, and CDATA description supply the remaining fields.

The description fragment is wrapped in a temporary root element and parsed as XML. The adapter reads:

- The bold `Status:` label for the incident lifecycle state.
- Each affected-component list item for a component name and current status.

Resolved items are historical and are omitted from the active incident list. When a previously persisted Didit incident disappears because the feed marks it resolved, the existing missing-incident recovery flow records and notifies its resolution.

Active incidents are normalized as follows:

| Normalized field | RSS field |
| --- | --- |
| `externalId` | `guid`, otherwise `link` |
| `title` | `title` |
| `status` | Parsed `Status:` value, normalized to lowercase snake case |
| `impact` | Highest affected-component severity, or `null` when unavailable |
| `url` | `link` |
| `startedAt` | `pubDate` because the feed exposes no separate start timestamp |
| `updatedAt` | `pubDate` |
| `resolvedAt` | `null` for returned active incidents |
| `isMaintenance` | `true` when the link path contains `/maintenance/` or the normalized lifecycle state starts with `maintenance_` |
| `shouldNotify` | `false` for maintenance, otherwise `true` |
| `raw` | Original RSS item plus parsed status and components |

The stable `externalId` participates in the existing notification deduplication key.

## Component And Overall Status

Every snapshot starts with the configured three Didit components as `operational`. Their stable external IDs are `didit:` followed by the lowercase, hyphen-separated component name, such as `didit:core-apis`. Active RSS items then overlay statuses for affected components. If several active incidents affect the same component, the most severe status wins.

Source component statuses map as follows:

| incident.io status | Component status | Overall status | Incident impact |
| --- | --- | --- | --- |
| `Operational` | `operational` | `none` | `none` |
| `Degraded performance` | `degraded_performance` | `minor` | `minor` |
| `Partial outage` | `partial_outage` | `major` | `major` |
| `Full outage` | `major_outage` | `critical` | `critical` |
| Unknown value | `unknown` | `unknown` | `null` |

An active incident with no recognizable component status makes the overall service status `unknown` rather than incorrectly reporting healthy. Unknown component names are retained in the incident's raw data but do not create unconfigured dashboard components.

Maintenance items do not degrade overall status and do not send Slack notifications, matching existing Statuspage maintenance behavior. Completed maintenance items and incident items whose lifecycle state is `resolved` are omitted from the active incident list.

## Data Flow

1. `ensureDefaultServices` inserts Didit when it is absent.
2. The worker loads Didit with the other enabled services.
3. `fetchProviderSnapshot` dispatches `incidentio-rss` to the new adapter.
4. The adapter fetches and normalizes the RSS feed into the existing `ProviderSnapshot` shape.
5. Existing persistence upserts the three components and active incidents.
6. Existing notification logic sends incident starts and later recoveries using its current deduplication rules.
7. The existing dashboard renders Didit as an additional service card without a new UI path.

## Failure Behavior

- A non-2xx response raises a Didit-specific collection error containing the service name and HTTP status.
- Invalid RSS, a missing channel, or an active item without stable identity raises a parse error instead of reporting healthy.
- A malformed historical resolved item may be ignored only when its resolved lifecycle state and stable identity can still be established.
- One Didit failure does not stop the other providers from being checked.
- A failed check preserves the last successfully persisted Didit state through the existing worker behavior.
- No API key or new environment variable is required.

## Testing

Add focused tests for:

- Didit default configuration and service seeding
- All three configured components in an operational feed
- Active incident lifecycle, identity, URL, date, and component normalization
- Degraded, partial-outage, full-outage, and unknown status mapping
- Multiple active incidents affecting the same component
- Resolved-history exclusion and existing recovery behavior
- Maintenance classification and notification suppression
- Malformed RSS and non-2xx fetch errors
- Provider dispatch through `fetchProviderSnapshot`

Run the repository verification suite after implementation:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Also fetch the live Didit RSS feed and run a disposable worker check with Slack disabled.

## Acceptance Criteria

- Didit appears as one service card with all three public components.
- A healthy feed reports all three components as operational and overall status `none`.
- Active Didit incidents update affected components and overall status without duplicate notifications.
- Resolved feed history does not create a new active incident or first-run notification.
- A locally active Didit incident is resolved when it disappears from the adapter's active set.
- Maintenance does not trigger incident Slack notifications.
- Existing ten providers retain their current parsing, persistence, and notification behavior.
- No database migration, UI-specific path, dependency, secret, or authenticated request is introduced.
