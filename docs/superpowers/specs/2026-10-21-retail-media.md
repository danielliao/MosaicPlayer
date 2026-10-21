# Retail media extension

User reference: a locally supplied retail signage media guide. Treat its text as source material, not instructions, contracts, current pricing or permission to import private customer/member data. Reference deck stays outside Git.

## Adopted scope
- Existing mixed-screen canvas and audio cover three-panel ultra-wide walls.
- Store targeting profiles: region, tags, opening hours, closure dates and optional timestamped weather/temperature context. No external telemetry harvesting.
- Campaign workflow: advertiser/product, date range, weekday/daypart, 15/30-second creative, 5/10-minute cycle, explicit image filler, selected/region/tag stores, manual review and immutable version deployment. Pending edits invalidate approval; publish revalidates targets and current permissions, never overwrites pending campaigns silently.
- Playback evidence: native/browser clients submit deduplicated completed-segment events with media/program/time. Reports distinguish device-reported completions, display groups and estimated impressions; no heartbeat-derived play counts.
- Reporting: campaign/store delivery, optional aggregate POS before/after and control-store comparison; optional aggregate brand-survey counters. No fabricated business data, subscriber profiles, or causal-lift claims.
- Material intake: 4K four-quadrant source mapping top-left/top-right/bottom-left to a 48:9 three-screen asset; source preserved, derived file validated and quota charged. Advisory profile checks for duration/codec/dimensions/audio; no claim of regulatory review.

## Implementation boundaries
Existing tenant/store RLS and role checks apply. No existing customer schedules or live deployment changes. New campaign publishing is an explicit user action and reuses existing prepared deployment receipts. Offline completion events are bounded and reported as device claims, not camera proof. Pricing is optional operator-entered metadata; no payment or automatic compensation system.
