/**
 * Simple test cases to demonstrate the normalizer functionality
 */

import { normalizeSchema, normalizeTools } from "./normalizer.ts";

type MutableSchema = {
  type?: string;
  properties?: Record<string, MutableSchema>;
  [key: string]: unknown;
};

function testBasicNormalization() {
  console.log("=== Test: Basic Schema Normalization ===");

  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number", minimum: 0 },
      email: { type: "string", format: "email" },
    },
    required: ["name", "email"],
  };

  const result = normalizeSchema(schema);
  console.log("Input:", JSON.stringify(schema, null, 2));
  console.log("Output:", JSON.stringify(result.schema, null, 2));
  console.log("Errors:", result.errors);
  console.log("Warnings:", result.warnings);
  console.log();
}

function testNullableHandling() {
  console.log("=== Test: Nullable Type Handling ===");

  const schema = {
    type: "string",
    nullable: true,
  };

  const result = normalizeSchema(schema);
  console.log("Input:", JSON.stringify(schema, null, 2));
  console.log("Output:", JSON.stringify(result.schema, null, 2));
  console.log();
}

function testUnsupportedKeywords() {
  console.log("=== Test: Unsupported Keywords Removal ===");

  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    $id: "https://example.com/schema",
    examples: [{ foo: "bar" }],
    properties: {
      value: {
        type: "number",
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
      },
    },
  };

  const result = normalizeSchema(schema);
  console.log("Input:", JSON.stringify(schema, null, 2));
  console.log("Output:", JSON.stringify(result.schema, null, 2));
  console.log("Warnings:", result.warnings);
  console.log();
}

function testDescriptionGeneration() {
  console.log("=== Test: Description Generation ===");

  const schema = {
    type: "object",
    properties: {
      userName: { type: "string" },
      userAge: { type: "integer" },
      isActive: { type: "boolean" },
    },
  };

  const result = normalizeSchema(schema, { generateDescriptions: true });
  console.log("Input:", JSON.stringify(schema, null, 2));
  console.log("Output:", JSON.stringify(result.schema, null, 2));
  console.log();
}

function testNestedObjects() {
  console.log("=== Test: Nested Object Normalization ===");

  const schema = {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          profile: {
            type: "object",
            properties: {
              bio: { type: "string" },
            },
          },
        },
      },
    },
  };

  const result = normalizeSchema(schema, { generateDescriptions: true });
  console.log("Input:", JSON.stringify(schema, null, 2));
  console.log("Output:", JSON.stringify(result.schema, null, 2));
  console.log();
}

function testToolsNormalization() {
  console.log("=== Test: Tools Normalization ===");

  const tools = [
    {
      function_declarations: [
        {
          name: "getUserInfo",
          parameters: {
            type: "object",
            properties: {
              userId: { type: "string" },
              includeEmail: { type: "boolean", nullable: true },
            },
            required: ["userId"],
          },
        },
      ],
    },
  ];

  const result = normalizeTools(tools);
  console.log("Input:", JSON.stringify(tools, null, 2));
  console.log("Output:", JSON.stringify(result.tools, null, 2));
  console.log("Errors:", result.errors);
  console.log("Warnings:", result.warnings);
  console.log();
}

function testCircularReferenceDetection() {
  console.log("=== Test: Circular Reference Detection ===");

  const schema: MutableSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
    },
  };

  // Create circular reference
  if (schema.properties) {
    schema.properties.self = schema;
  }

  const result = normalizeSchema(schema);
  console.log(
    "Has circular reference errors:",
    result.errors.some((e) => e.type === "circular_reference"),
  );
  console.log("Errors:", result.errors);
  console.log();
}

function testDepthLimiting() {
  console.log("=== Test: Depth Limiting ===");

  // Create deeply nested schema
  const schema: MutableSchema = { type: "object" };
  let current: MutableSchema = schema;

  for (let i = 0; i < 15; i++) {
    current.properties = {
      nested: { type: "object" },
    };
    current = current.properties.nested as MutableSchema;
  }

  const result = normalizeSchema(schema, { maxDepth: 5 });
  console.log(
    "Has max depth errors:",
    result.errors.some((e) => e.type === "max_depth_exceeded"),
  );
  console.log("Errors:", result.errors);
  console.log();
}

function testInferredRequired() {
  console.log("=== Test: Inferred Required Fields ===");

  const schema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      email: { type: "string", nullable: true },
      age: { type: "number", optional: true },
    },
  };

  const result = normalizeSchema(schema, { inferRequired: true });
  console.log("Input:", JSON.stringify(schema, null, 2));
  console.log("Output:", JSON.stringify(result.schema, null, 2));
  console.log("Inferred required:", result.schema.required);
  console.log();
}

// Run all tests
if (import.meta.main) {
  testBasicNormalization();
  testNullableHandling();
  testUnsupportedKeywords();
  testDescriptionGeneration();
  testNestedObjects();
  testToolsNormalization();
  testCircularReferenceDetection();
  testDepthLimiting();
  testInferredRequired();

  console.log("✓ All tests completed!");
}
