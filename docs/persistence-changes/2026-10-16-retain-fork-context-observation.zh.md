---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-retain-fork-context-observation

[English](2026-10-16-retain-fork-context-observation.md) | 中文

## 概述

合并 upstream 时保留 fork master 中记录外部上下文占用的事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新增声明识别携带 usedTokens 和 contextWindow 的 token-meter/context-observed 记录。已有事件记录不变。不包含此声明的读取方拒绝未知且未标记可忽略的记录；既有 ignorable 信封标记允许跳过未知事件。此事件不属于对话表面事件。

<a id="verification"></a>
## 验证

工具行、准备行、差异卡片、上下文计量与用量投影五个 Vitest 文件共 165 项测试通过。持久化目录生成器和历史格式引用检查已针对合并后的源码执行。

<a id="dev-note"></a>
## 开发备注

无。
