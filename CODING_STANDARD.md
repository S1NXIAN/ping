# CODING_STANDARD.md

Project-agnostic coding standards for the agent: behavioral rules that apply to any
language, framework, or repo. Where a repo states a more specific rule, that rule wins.

## 1. Change discipline

- Code the task does not require is left untouched.
- New code follows the surrounding conventions for naming, structure, error handling, and
  formatting.

## 2. Correctness

- Every fallible call's result is used, or explicitly discarded with a stated reason.
- A caught error is either handled or propagated; none is swallowed without a recorded
  reason.
- A failing command, package, or configuration is reported with its actual error, and the
  fix changes the cause rather than routing around it. Workarounds, mock drivers,
  polyfills, and alternative libraries are added only when the task requests them.

## 3. Verification

- After a change, run typecheck, lint, and the tests covering what you touched.
- The reported result names the command run and its outcome.
- A check that could not run is reported as not run with its reason; it is never reported
  as passed.
- The task is done when its acceptance criterion is demonstrably met.

## 4. Tests

- Each test asserts one behavior and is named for that behavior.
- A test's inputs and expected outputs are fixed; results do not depend on wall-clock
  time, network, or execution order.

## 5. Security and data

- Secrets, tokens, and credentials come from the environment or a secret store; none
  appear in source, logs, or committed config.
- External input is validated and encoded at the boundary before use.
- Data access uses parameterized queries and safe APIs; SQL, shell, and paths are never
  built by string interpolation.
- Logs and error messages contain no secrets, personal data, or full request bodies.

## 6. Comments and docs

- Most code gets no comment.
- A comment explains a reason the code cannot express itself; one that restates the name,
  signature, type, or the line below it adds nothing — the code already says it.
- A non-obvious decision is recorded where it is made, linked to its issue or ADR rather
  than restated.
