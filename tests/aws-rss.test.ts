import { describe, expect, it } from "vitest";
import { parseAwsRss, shouldIncludeAwsIncident } from "@/lib/status/adapters/aws";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Amazon Web Services Service Status</title>
    <lastBuildDate>Tue, 12 May 2026 03:04:19 PDT</lastBuildDate>
    <item>
      <title>Service disruption: Increased Error Rates</title>
      <link>https://status.aws.amazon.com/</link>
      <pubDate>Tue, 12 May 2026 03:04:19 PDT</pubDate>
      <guid isPermaLink="false">https://status.aws.amazon.com/#ec2-us-east-1_1777533954</guid>
      <description>We are investigating increased error rates in the US East (N. Virginia) Region (US-EAST-1).</description>
    </item>
    <item>
      <title>Service disruption: Increased API Error Rates</title>
      <link>https://status.aws.amazon.com/</link>
      <pubDate>Tue, 12 May 2026 02:04:19 PDT</pubDate>
      <guid isPermaLink="false">https://status.aws.amazon.com/#ec2-eu-west-1_1777530000</guid>
      <description>We are investigating issues in the EU (Ireland) Region (EU-WEST-1).</description>
    </item>
  </channel>
</rss>`;

describe("parseAwsRss", () => {
  it("keeps Slack-notifiable AWS incidents only for configured regions", () => {
    const snapshot = parseAwsRss(rss, ["ap-northeast-2", "us-east-1", "us-east-2", "us-west-1", "us-west-2"]);

    expect(snapshot.incidents).toHaveLength(2);
    expect(snapshot.incidents[0]).toMatchObject({
      externalId: "https://status.aws.amazon.com/#ec2-us-east-1_1777533954",
      shouldNotify: true,
      impact: "major"
    });
    expect(snapshot.incidents[1]).toMatchObject({
      externalId: "https://status.aws.amazon.com/#ec2-eu-west-1_1777530000",
      shouldNotify: false
    });
  });
});

describe("shouldIncludeAwsIncident", () => {
  it("matches region codes and public region names case-insensitively", () => {
    expect(shouldIncludeAwsIncident("Issue in Seoul ap-northeast-2", ["ap-northeast-2"])).toBe(true);
    expect(shouldIncludeAwsIncident("Issue in US West (Oregon)", ["us-west-2"])).toBe(true);
    expect(shouldIncludeAwsIncident("Issue in EU (Ireland)", ["us-east-1"])).toBe(false);
  });
});
