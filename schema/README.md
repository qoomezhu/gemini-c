# Schema Normalizer Module

This module provides comprehensive JSON Schema Draft 2020-12 normalization for
Gemini 2.5 API tool schemas.

## Overview

Historically, the proxy performed only shallow sanitization of function schemas,
dropping keywords such as `$ref`, `anyOf`, and exclusive bounds while assuming a
plain object payload. Gemini 2.5 requires compliant JSON Schema Draft 2020-12
documents with accurate type information, nullable handling via unions, nested
property descriptions, and numeric bounds.

This normalizer module introduces a pure normalization pipeline that retains
backwards compatibility with lightweight schemas while upgrading them to Draft
2020-12 semantics.

## Features

### Core Capabilities

- **JSON Schema Draft 2020-12 Compliance**: Full support for primitives (`type`,
  `enum`, `const`, `pattern`, `format`, numeric bounds, array
  `items`/`minItems`/`maxItems`, object
  `properties`/`additionalProperties`/`patternProperties`)
- **Nullable Type Handling**: Converts `nullable: true` to proper type unions
  (e.g., `["string", "null"]`)
- **Recursive Normalization**: Handles deeply nested schemas with circular
  reference detection
- **Automatic Description Generation**: Creates human-readable descriptions from
  property names and types
- **Intelligent Required Arrays**: Validates, infers, and ensures required
  fields exist in properties
- **Unsupported Keyword Removal**: Strips `$schema`, `$id`, `$ref`, `examples`,
  `anyOf`, `oneOf`, etc.
- **Depth Limiting**: Configurable maximum nesting depth to prevent infinite
  recursion
- **Performance Optimized**: Minimal allocations for Deno Deploy constraints

### Configuration Options

```typescript
interface NormalizationConfig {
  maxDepth?: number; // Default: 12
  generateDescriptions?: boolean; // Default: true
  inferRequired?: boolean; // Default: true
}
```

## API Reference

### `normalizeSchema(schema, config?)`

Normalizes a single JSON schema object.

```typescript
import { normalizeSchema } from "./schema/normalizer.ts";

const result = normalizeSchema({
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number", nullable: true },
  },
});

console.log(result.schema); // Normalized schema
console.log(result.errors); // Array of errors
console.log(result.warnings); // Array of warnings
```

### `normalizeTools(tools, config?)`

Normalizes Gemini tool declarations with function schemas.

```typescript
import { normalizeTools } from "./schema/normalizer.ts";

const tools = [
  {
    function_declarations: [
      {
        name: "getUserInfo",
        parameters: {
          type: "object",
          properties: {
            userId: { type: "string" },
          },
        },
      },
    ],
  },
];

const result = normalizeTools(tools);
console.log(result.tools); // Normalized tools
console.log(result.errors); // Array of errors
console.log(result.warnings); // Array of warnings
```

### `validateNormalizedSchema(schema)`

Validates a normalized schema for common issues.

```typescript
import { validateNormalizedSchema } from "./schema/normalizer.ts";

const errors = validateNormalizedSchema(schema);
if (errors.length > 0) {
  console.error("Validation errors:", errors);
}
```

## Schema Transformations

### Nullable Types

**Input:**

```json
{
  "type": "string",
  "nullable": true
}
```

**Output:**

```json
{
  "type": ["string", "null"]
}
```

### Unsupported Keywords

**Input:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "$ref": "#/definitions/User",
  "anyOf": [{ "type": "string" }, { "type": "number" }]
}
```

**Output:**

```json
{
  "type": "object"
}
```

Warnings: `Removed unsupported keyword '$schema'`,
`Removed unsupported keyword '$ref'`, `anyOf simplified`

### Description Generation

**Input:**

```json
{
  "type": "object",
  "properties": {
    "userName": { "type": "string" },
    "userAge": { "type": "integer" }
  }
}
```

**Output:**

```json
{
  "type": "object",
  "properties": {
    "userName": {
      "type": "string",
      "description": "User Name (string)."
    },
    "userAge": {
      "type": "integer",
      "description": "User Age (integer)."
    }
  }
}
```

### Required Field Inference

**Input:**

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "email": { "type": "string", "nullable": true },
    "age": { "type": "number", "optional": true }
  }
}
```

**Output:**

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Id (string)."
    },
    "email": {
      "type": ["string", "null"],
      "description": "Email (string or null)."
    },
    "age": {
      "type": "number",
      "description": "Age (number)."
    }
  },
  "required": ["id"]
}
```

## Error Handling

The normalizer returns detailed error information:

```typescript
interface NormalizationError {
  type:
    | "circular_reference"
    | "max_depth_exceeded"
    | "invalid_schema"
    | "validation_error";
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}
```

### Circular Reference Detection

```typescript
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
  },
};
schema.properties.self = schema; // Circular reference

const result = normalizeSchema(schema);
// Error: { type: "circular_reference", message: "Circular reference detected", path: "self" }
```

### Depth Limiting

```typescript
// Deeply nested schema exceeding maxDepth
const result = normalizeSchema(deepSchema, { maxDepth: 5 });
// Error: { type: "max_depth_exceeded", message: "Maximum depth of 5 exceeded", path: "..." }
```

## Testing

Run the test suite:

```bash
deno run schema/test_normalizer.ts
```

## Integration

The module is integrated into `deno_index.ts` through legacy wrapper functions:

```typescript
import { normalizeSchema, normalizeTools } from "./schema/normalizer.ts";

// Legacy wrapper for backward compatibility
export function transformGeminiSchema(tools: unknown[]): unknown[] {
  const result = normalizeTools(tools);
  // ... handle errors/warnings
  return result.tools;
}

export function cleanSchema(schema: unknown): unknown {
  const result = normalizeSchema(schema);
  // ... handle errors/warnings
  return result.schema;
}
```

## Performance Considerations

- Uses `WeakSet` for circular reference tracking (minimal memory overhead)
- Depth limiting prevents infinite recursion
- Single-pass normalization with minimal allocations
- Optimized for Deno Deploy edge runtime constraints

## Supported JSON Schema Keywords

### Type System

- `type` (string or array)
- `enum`
- `const`
- `nullable` (converted to type union)

### String Constraints

- `pattern`
- `format`
- `minLength`
- `maxLength`

### Numeric Constraints

- `minimum`
- `maximum`
- `exclusiveMinimum`
- `exclusiveMaximum`
- `multipleOf`

### Array Constraints

- `items`
- `minItems`
- `maxItems`
- `uniqueItems`
- `contains`

### Object Constraints

- `properties`
- `required`
- `additionalProperties`
- `patternProperties`
- `minProperties`
- `maxProperties`

### Metadata

- `title`
- `description`

## Unsupported Keywords (Removed)

- `$schema`, `$id`, `$ref`, `$defs`, `definitions`
- `examples`, `$comment`
- `readOnly`, `writeOnly`, `deprecated`
- `contentMediaType`, `contentEncoding`
- `if`, `then`, `else`
- `allOf`, `anyOf`, `oneOf`, `not`

These keywords are automatically removed during normalization with appropriate
warnings.
