# CODING_STANDARD.md

This document establishes the repository-level coding standards and quality gates for human developers and AI coding assistants. 

## 1. Code Complexity & Cognitive Budget

Writing functional code is only half the battle; maintaining readability, simplicity, and low cognitive overhead is the standard for professional engineering.

### 1.1 Cognitive vs. Algorithmic Complexity
*   **Algorithmic Complexity (Big-O):** Quantifies mathematical runtime and storage requirements as input sizes scale.
*   **Code Complexity:** Measures the cognitive effort required for a human developer to read, maintain, and reason about code. Because developers spend up to **70% of their time reading and parsing code** to reconstruct intent, we actively optimize for minimal cognitive load.
*   **AI Density Guardrail:** To combat the quality degradation of automated "vibe coding" (which research shows increases code duplication by **4x** and code complexity by **41%**), all modifications must be rigorously reviewed for structural cohesion and formatting consistency.

### 1.2 Structural Rules
*   **Nesting Limit:** Nesting must not exceed **3 levels**. Deeply nested conditional structures represent a failure of logical decomposition.
*   **Cyclomatic Complexity Limit:** No single function may exceed a cyclomatic complexity score of **10** (measured by branches/paths).
*   **Small Scopes:** Define and initialize variables in the smallest scope possible. Keep file sizes capped at **300–500 lines**; files exceeding this must be decomposed into logical submodules.

---

## 2. Linguistic Architecture (Naming Conventions)

Since code primarily consists of custom names, naming is our most powerful abstraction tool. Consistent, descriptive, and unambiguous names act as a self-documenting guide.

### 2.1 Typographic Rules & Casing
Casing is per-language. The generated document's Section 8 carries the casing table for the detected stack.

### 2.2 Grammatical Mapping
*   **Classes and Objects:** Must be nouns or noun phrases (e.g., `UserAccount`, `PaymentProcessor`). Never use verbs.
*   **Methods and Functions:** Must start with a verb or verb phrase representing the action performed (e.g., `getActiveUsers()`, `calculateTax()`).
*   **Boolean Variables and Functions:** Must carry a distinct prefix indicating an interrogative state (e.g., `is/has/can` such as `is_active`, `has_permission`, `can_write`).

### 2.3 Semantic Hygiene
*   **Intent Over Implementation:** Names must describe *why* an entity exists and *what* it represents semantically, not how it is implemented. 
    *   ❌ `Poor:` `intList` or `doubleValue`
    *   ✅ `Good:` `flaggedCells` or `monthlyTotal`
*   **Differentiate with Meaning:** Avoid vague noise words that add zero context (e.g., `data`, `info`, `process`, `temp`). Avoid naming variables sequentially (e.g., `user1`, `user2`).
*   **Singular vs. Plural:** Single values must use singular nouns; collections (arrays, lists, sets) must use pluralized names (e.g., `scores`, `users`). Use collective nouns where appropriate (e.g., `calendar` instead of `appointments`).
*   **Precise Word Pairs (Antonyms):** Always pair operations symmetrically:
    *   `get / set` | `create / destroy` | `open / close` | `start / stop` | `minimum / maximum` | `next / previous`

---

## 3. Structural Design & Flow Control

Our architectural goal is to write \"sentence-like\" linear code that reads cleanly like prose.

### 3.1 Flattening Nesting via Guard Clauses
Eliminate deeply nested `if-else` blocks and "train wreck" conditional structures by applying the **Guard Clause (Early Return) Pattern**.
Validate boundary inputs and execute exception handlers immediately at the top of the function, leaving the happy path flat and un-nested.

```typescript
// ❌ Bad (Nested "If-Else" Hell)
async function registerUser(user: UserSpec) {
  if (validateInput(user)) {
    const existing = await findUser(user.email);
    if (!existing) {
      const hash = await hashPassword(user.password);
      return saveUser({ ...user, password: hash });
    } else {
      throw new Error("User exists");
    }
  } else {
    throw new Error("Invalid input");
  }
}

// ✅ Better (Early Returns / Guard Clauses)
async function registerUser(user: UserSpec) {
  if (!validateInput(user)) throw new Error("Invalid input");
  
  const existing = await findUser(user.email);
  if (existing) throw new Error("User exists");

  const hash = await hashPassword(user.password);
  return saveUser({ ...user, password: hash });
}
```

### 3.2 Composition Over Step Mutation
Within functions, do not repeatedly mutate or reassign the same variable over successive steps. Instead, compute distinct components and compose them cleanly in a single, final step.

```typescript
// ❌ Bad (Step Mutation)
let total = 0;
total += getSalary();
total -= getTaxes();

// ✅ Better (Single-Step Composition)
const salary = getSalary();
const taxes = getTaxes();
const totalPay = salary - taxes;
```

---

## 4. Type Systems as Living Documentation

Primitives (strings, numbers) are weak boundaries that allow logic bugs to slip past. We utilize modern type features to declare invariants programmatically.

### 4.1 Eradicating Primitive Obsession
Do not pass raw primitives to model highly specialized business concepts. Wrap them in dedicated, immutable **Value Objects** that guarantee data validity inside their constructors.

```typescript
// ❌ Bad (Primitive Obsession)
function shipPackage(weight: number) { ... } // What unit is this? Grams? Pounds?

// ✅ Better (Value Object)
class Weight {
  private constructor(public readonly grams: number) {}
  
  static fromKilograms(kg: number): Weight {
    if (kg <= 0) throw new ArgumentError("Weight must be positive");
    return new Weight(kg * 1000);
  }
}
function shipPackage(weight: Weight) { ... }
```

### 4.2 Compile-Time Nominal Type Checking
Leverage language features to establish strict, compile-time nominal boundaries without runtime performance costs:
*   **TypeScript Branded Types:** Ensure type safety by attaching unique symbols.
*   **Python NewType:** Create helper subtypes that type checkers (such as `mypy`) validate statically.

### 4.3 JSDoc Static Typing (Pure JS Environments)
If working in plain JavaScript, enable IDE autocomplete and nominal typechecking by writing comprehensive JSDoc annotations and enabling static JS checks:

```javascript
/** @typedef {{ id: number, email: string, role: string }} User */

/**
 * Upgrades a validated user's system role.
 * @param {User} user - The system user
 * @param {string} newRole - The role to assign
 * @returns {Promise<User>} The updated user object
 */
async function upgradeRole(user, newRole) { ... }
```

---

## 5. API Contracts & Liskov Substitutability

An API is a binding contract between caller and implementation. We apply the **Design by Contract (DbC)** framework to secure system boundaries.

### 5.1 Preconditions, Postconditions, and Invariants
*   **Preconditions:** Explicit requirements that the caller *must* satisfy before executing a method. If violated, the method is not obligated to execute correctly.
*   **Postconditions:** Absolute guarantees that the method *must* satisfy upon successful execution, provided preconditions were met.
*   **Class Invariants:** Global state constraints that must remain completely undisturbed before and after any public execution loop.

### 5.2 The Liskov Substitution Principle (LSP)
Any subclass or implementation of an interface must be completely substitutable for its parent type without breaking client flow.
1.  **Preconditions Cannot Be Strengthened:** Subclasses must accept *at least* the same range of inputs as the parent.
2.  **Postconditions Cannot Be Weakened:** Subclasses must return *at most* the same range of outputs and preserve all parent guarantees.
3.  **Invariants Must Be Preserved:** Class state invariants established by parent types must remain fully unbroken.

---

## 6. Comment & Documentation Hygiene

Code communicates implementation (the \"how\"), whereas comments are strictly reserved for communicating business intent and trade-offs (the \"why\"). The best code requires minimal comments because its names and structure are self-explanatory.

### 6.1 The C1–C5 Quality Rules
To prevent context pollution and documentation rot, apply strict hygiene to all commentary:
*   **C1: No Inappropriate Information:** Never include administrative metadata (such as authors, ticket numbers, revision histories, or dates) in comments. Version control (Git) owns this information.
*   **C2: Delete Obsolete Comments:** Outdated comments that describe altered or deleted logic are dangerous misdirections. Comments must be updated or deleted immediately when logic changes.
*   **C3: No Redundant Comments:** Never write comments that mechanically repeat what the code obviously shows.
    *   ❌ `Bad:` `i += 1; // Increment i by 1`
    *   ✅ `Good:` `i += 1; // Offset for zero-indexed display arrays`
*   **C4: Write Comments Well:** Write clearly, concisely, and with correct grammar and spelling.
*   **C5: Never Commit Commented-Out Code (Zombie Code):** Commented-out blocks create visual noise and cognitive friction. If code is unused, delete it; Git remembers everything.

### 6.2 Docstring Formats (Public APIs)
Public API boundaries must carry structured documentation comments to generate auto-documentation (e.g., JSDoc, Javadoc, docstrings, or Doxygen):

```typescript
/**
 * Processes an order refund through our external payment provider.
 * 
 * Assumes order status is already validated as 'delivered'.
 * See Stripe API RFC-3986 for billing structures.
 * 
 * @param {string} orderId - Canonical ID of the order
 * @param {number} amount - Non-negative refund value
 * @returns {Promise<string>} Stripe transaction confirmation reference
 * @throws {PaymentException} If payment gateway is unreachable
 */
async function processRefund(orderId: string, amount: number): Promise<string> { ... }
```

### 6.3 Standardized TODO Comments
Use a structured, searchable format to flag outstanding tasks:
```typescript
// TODO: (@David) Implement a sliding-window algorithm to handle dataset sizes > 1M
// FIXME: Handle memory leakage occurring on rapid socket reconnection events
```

---

## 7. Commit Message Standards (Conventional Commits)

To maintain a highly readable, structured, and machine-parsable commit history, all changes checked into the repository must adhere to the **Conventional Commits 1.0.0 Specification** and the industry-standard **Seven Rules of Git Commits**.

### 7.1 Commit Message Structure
A standard commit message must follow this structural layout:
```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### 7.2 The Seven Rules of Great Git Commits
1.  **Separate the Subject from the Body:** Insert a single blank line between the subject line (header) and the explanatory body text.
2.  **Limit the Subject Line:** Restrict the subject line (including type and scope) to **50 characters or less** for clean readability, with a strict hard ceiling of 72 characters.
3.  **Capitalize the Subject Line:** Start the description after `type(scope):` in lowercase (matching the §7.6 examples and the spec samples), unless the repo mandates capitals — repo convention wins. (Beams' capitalize rule predates the `type:` prefix and cannot apply literally to the whole line.)
4.  **No Trailing Period:** Do not end the subject line with a trailing period.
5.  **Use the Imperative Mood:** Write the subject line in the imperative present tense (e.g., "Add billing module" instead of "Added billing module" or "Adds billing module"). A simple test: *If applied, this commit will "Add billing module"*.
6.  **Wrap the Body at 72 Characters:** Set hard line wraps at 72 characters in the optional body text to prevent horizontal overflow in standard git terminal outputs.
7.  **Explain the What and Why (Not the How):** Focus the body text on explaining *why* the change was made, *what* problem it addresses, and the reasoning behind it, rather than repeating *how* the implementation is coded.

### 7.3 Standard Commit Types
The `<type>` prefix describes the exact nature and intent of the change, which automatically dictates Semantic Versioning (SemVer) increments and changelog generation:
*   **`feat`:** Introduces a new feature to the codebase (correlates with a `MINOR` SemVer version bump).
*   **`fix`:** Patches a bug in the codebase (correlates with a `PATCH` SemVer version bump).
*   **`docs`:** Documentation-only changes (e.g., updating README, API references, or markdown standards).
*   **`style`:** Coding style or formatting changes (e.g., whitespaces, semicolons, spacing) that do not alter execution or business logic.
*   **`refactor`:** A code modification that neither fixes a bug nor adds a feature, but improves internal code structure.
*   **`perf`:** A performance-critical change designed to optimize execution speed or reduce memory consumption.
*   **`test`:** Appending missing tests or correcting existing unit, integration, or regression tests.
*   **`build` / `ci`:** Updates to build processes, auxiliary compile tools, or CI/CD pipelines/configurations.
*   **`chore`:** Auxiliary or administrative changes that do not modify production files or source code.
*   **`revert`:** Reverts a prior commit.

### 7.4 Scope and Context (Optional)
The optional `<scope>` SHOULD be a lowercase noun wrapped in parentheses following the commit type (e.g., `feat(auth):`, `fix(parser):`). It specifies the functional area or module affected by the commit, enabling effortless directory-scoped change tracking. The spec treats units as case-insensitive; lowercase is convention, not validity.

### 7.5 Documenting Breaking Changes (SemVer Major)
Breaking changes introduce incompatible API modifications requiring a `MAJOR` SemVer version bump. They must be declared by:
1.  An exclamation mark (`!`) immediately after the type/scope (e.g., `feat(billing)!: require Stripe SCA compliance`), or
2.  A `BREAKING CHANGE:` footer at the bottom of the commit message followed by a brief explanation of the breaking shift.
`BREAKING-CHANGE:` (hyphenated) is the equivalent footer form — footer tokens MUST use `-` in place of spaces, followed by `:` or ` #` (e.g., `Acked-by:`, `Refs #123`).

### 7.6 Architectural Examples
*   **Simple Feature with Scope:**
    ```text
    feat(auth): implement JWT token verification
    ```
*   **Bug Fix with Body and Footer:**
    ```text
    fix(button): correct alignment of CTA buttons on mobile layouts
    ```
*   **Breaking Change with Explanatory Body and Footer:**
    ```text
    feat(payment)!: upgrade Stripe integration to v2026-08-16

    This updates our billing checkout system to comply with Stripe's
    updated Payment Intents API, replacing direct credit card inputs.

    BREAKING CHANGE: The `chargeUser()` endpoint has been deprecated in 
    favor of the new secure `createPaymentIntent()` orchestration flow.
    ```

---

## 8. Language-Specific Standards

### 8.1 TypeScript

*   **Casing:** `camelCase` for variables, function names, and methods; `PascalCase` for classes, interfaces, types, and enums; `SCREAMING_SNAKE_CASE` for exported module constants.
*   **Formatting:** Use strict semicolons, single quotes, and 2-space indentation unless overridden by the repo formatter (`eslint.config.mjs` wins on conflict).
*   **No `any`:** NEVER use `any` — it disables typechecking. If a type is genuinely unknown at compile time, use `unknown` and narrow it with a type guard.
*   **Branded nominal types:** Distinct domain concepts that share a primitive shape (ids, emails, tokens) MUST use branded types so they cannot be silently swapped:
    ```typescript
    type Brand<K, T> = K & { readonly __brand: T };
    export type UserId = Brand<string, 'UserId'>;
    export type EmailAddress = Brand<string, 'EmailAddress'>;
    function deleteUser(userId: UserId, email: EmailAddress) { ... }
    ```
*   **Discriminated unions for fallible state:** Model results and complex states as discriminated unions so the compiler enforces exhaustive handling:
    ```typescript
    type Result<T> =
      | { readonly success: true; readonly data: T }
      | { readonly success: false; readonly error: Error };
    ```
*   **Async flow:** Always prefer `async`/`await` over raw `.then().catch()` chains; validate responses with guard clauses and throw on failure.

### 8.2 JavaScript (plain `.js`/`.mjs`, `allowJs` boundary files)

*   **Strict mode:** Every plain-JS module MUST run under strict mode (`"use strict";` at the top, or ESM semantics).
*   **JSDoc static typing:** Public functions in plain-JS files MUST carry JSDoc `@param`/`@returns` annotations with `// @ts-check` (or repo-wide `checkJs`) so editors and checkers catch type errors without compilation.
*   **Safe boundaries:** NEVER mutate built-in prototypes (`Array.prototype`, `Object.prototype`, `String.prototype`). Prefer immutable composition (`map`, `filter`, `reduce`, spread) over in-place index mutation.

### 8.3 API Contracts (`src/app/api/**/*.ts` route handlers)

*   **Explicit path versioning:** Public versioned endpoints MUST carry a version prefix (e.g., `GET /v1/monitors/:id`). NEVER introduce a breaking change (deleted field, changed type, altered error shape) on an active version — ship a new version and keep the old contract serving.
*   **Schema-driven validation:** Every route handler MUST parse and validate incoming payloads (and outgoing response shapes where non-trivial) at runtime with `zod` (already a repo dependency). Unvalidated `request.json()` MUST NOT flow into business logic:
    ```typescript
    import { z } from 'zod';
    const MonitorCreateSchema = z.object({
      name: z.string().min(1),
      url: z.string().url(),
      intervalSeconds: z.number().int().positive(),
    });
    const payload = MonitorCreateSchema.parse(await request.json());
    ```
*   **Standardized collection envelope:** Collection responses MUST wrap items in an envelope separating items from pagination metadata — NEVER return a bare top-level JSON array:
    ```json
    {
      "data": [{ "id": "42", "name": "homepage" }],
      "pagination": { "limit": 20, "offset": 0, "totalCount": 420, "hasMore": true }
    }
    ```
*   **Idempotency on mutative endpoints:** Endpoints that move money, send notifications, or create billing-relevant records MUST accept and validate an `Idempotency-Key` header so client retries cannot double-apply the mutation.
