---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-retain-fork-context-observation

English | [中文](2026-10-16-retain-fork-context-observation.zh.md)

## Summary

Retains the fork master event for externally observed context occupancy when merging upstream.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-retain-fork-context-observation
baseline: false
changes:
  - root: "event:token-meter/context-observed"
    previous: null
    after: "118db853acb559cbc3f01d6232a0e9a607d3cce318e180279311464c0b833fb6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new declaration recognizes token-meter/context-observed records carrying usedTokens and contextWindow. Existing event records remain unchanged. Readers without this declaration refuse unknown non-ignorable records; the existing ignorable envelope flag permits skipping unknown events. The event is not a conversation surface event.

<a id="verification"></a>
## Verification

The focused tool-row, preparing-row, diff-card, context-meter and token-usage-projection Vitest suites passed: 165 tests in five files. The persistence catalog generator and historical format reference checks ran against the merged source.

<a id="dev-note"></a>
## Dev Note

None.
