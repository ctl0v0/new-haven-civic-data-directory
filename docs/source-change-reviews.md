# Reviewing source changes

The shared source validator compares meaningful findings with the last published run. Timestamps, run links and code revisions alone do not trigger review. The first set of detailed findings establishes a baseline.

Changed results, warnings, field definitions, coverage or tested document/record fingerprints create or update one GitHub review issue per source. Repeat publication of the same change does not duplicate it. A later change can reopen that source's issue; notes outside the generated evidence block are preserved.

A person or agent reviews the prior and current run, reproduces the relevant check and proposes a small pull request updating limitations, preparation notes, access instructions or readiness only where supported. Merging that pull request regenerates the page and agent brief. Checks never silently rewrite those assessments.

A successful check is scoped evidence, not proof of current officeholding, boundary currency, complete accuracy or reuse permission. The workflow uses its repository token with issue-write permission; no new external credential is required.
