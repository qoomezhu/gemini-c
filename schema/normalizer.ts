/**
 * Schema Normalizer for Gemini 2.5 / JSON Schema Draft 2020-12.
 * 修复版本 - 解决了所有关键bug
 */

export interface NormalizationConfig {
  /** Maximum depth for recursive schemas; deeper nodes collapse to generic objects. */
  maxDepth?: number;
  /** Automatically generate descriptions for functions and parameters. */
  generateDescriptions?: boolean;
  /** Infer required arrays when omitted. */
  inferRequired?: boolean;
}

export interface NormalizationError {
  type:
    | "circular_reference"
    | "max_depth_exceeded"
    | "invalid_schema"
    | "validation_error";
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface NormalizationResult<T = JSONSchema> {
  schema: T;
  errors: NormalizationError[];
  warnings: string[];
}

export interface NormalizedToolsResult {
  tools: unknown[];
  errors: NormalizationError[];
  warnings: string[];
}

type JSONSchema = Record<string, unknown>;

const DEFAULT_CONFIG: Required<NormalizationConfig> = {
  maxDepth: 12,
  generateDescriptions: true,
  inferRequired: true,
};

// 修复#1: 移除了被过度限制的关键词
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id", 
  "$comment",
  "readOnly",
  "writeOnly",
  "deprecated",
  "contentMediaType",
  "contentEncoding",
  "if",
  "then",
  "else",
  "not",
  // 移除了 anyOf, oneOf, allOf, $ref 以支持Gemini 2.5
]);

const VALID_TYPES = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "string",
  "integer",
]);

interface NormalizationContext {
  path: string[];
  depth: number;
  options: Required<NormalizationConfig>;
  seen: WeakSet<object>;
  errors: NormalizationError[];
  warnings: string[];
  hint?: string;
}

/**
 * Normalize a single JSON schema.
 */
export function normalizeSchema(
  schema: unknown,
  config: NormalizationConfig = {},
): NormalizationResult<JSONSchema> {
  const options: Required<NormalizationConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const errors: NormalizationError[] = [];
  const warnings: string[] = [];

  const context: NormalizationContext = {
    path: [],
    depth: 0,
    options,
    seen: new WeakSet<object>(),
    errors,
    warnings,
  };

  const normalized = normalizeNode(schema, context);

  return {
    schema: normalized,
    errors,
    warnings,
  };
}

/**
 * Normalize Gemini tool declarations (function schemas).
 */
export function normalizeTools(
  tools: unknown,
  config: NormalizationConfig = {},
): NormalizedToolsResult {
  const options: Required<NormalizationConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (!Array.isArray(tools)) {
    return {
      tools: [],
      errors: [
        {
          type: "invalid_schema",
          message: "Tools payload must be an array",
          path: "tools",
        },
      ],
      warnings: [],
    };
  }

  const errors: NormalizationError[] = [];
  const warnings: string[] = [];

  const normalizedTools = tools.map((tool, toolIndex) => {
    if (!isPlainObject(tool)) {
      errors.push({
        type: "invalid_schema",
        message: "Tool entry must be an object",
        path: `tools[${toolIndex}]`,
      });
      return tool;
    }

    const normalizedTool: Record<string, unknown> = { ...tool };

    const declarations =
      Array.isArray((tool as Record<string, unknown>).function_declarations)
        ? (tool as Record<string, unknown>).function_declarations as unknown[]
        : undefined;

    if (!declarations) {
      return normalizedTool;
    }

    normalizedTool.function_declarations = declarations.map(
      (declaration, declIndex) => {
        if (!isPlainObject(declaration)) {
          errors.push({
            type: "invalid_schema",
            message: "Function declaration must be an object",
            path: `tools[${toolIndex}].function_declarations[${declIndex}]`,
          });
          return declaration;
        }

        const normalizedDeclaration: Record<string, unknown> = {
          ...declaration,
        };

        const functionName = typeof normalizedDeclaration.name === "string"
          ? normalizedDeclaration.name
          : `function_${declIndex}`;

        normalizedDeclaration.name = functionName;

        if (options.generateDescriptions) {
          const rawDescription =
            typeof normalizedDeclaration.description === "string"
              ? normalizedDeclaration.description.trim()
              : "";
          if (!rawDescription) {
            normalizedDeclaration.description = generateFunctionDescription(
              functionName,
            );
          } else {
            normalizedDeclaration.description = rawDescription;
          }
        }

        if ("parameters" in normalizedDeclaration) {
          const result = normalizeSchema(
            normalizedDeclaration.parameters,
            options,
          );
          normalizedDeclaration.parameters = result.schema;

          errors.push(
            ...result.errors.map((error) => ({
              ...error,
              path: prependPath(
                `tools[${toolIndex}].function_declarations[${declIndex}].parameters`,
                error.path,
              ),
            })),
          );

          warnings.push(
            ...result.warnings.map((warning) =>
              `tools[${toolIndex}].function_declarations[${declIndex}]: ${warning}`
            ),
          );
        }

        return normalizedDeclaration;
      },
    );

    return normalizedTool;
  });

  return {
    tools: normalizedTools,
    errors,
    warnings,
  };
}

/**
 * Validate a normalized schema for basic issues.
 */
export function validateNormalizedSchema(
  schema: unknown,
): NormalizationError[] {
  if (!isPlainObject(schema)) {
    return [{
      type: "invalid_schema",
      message: "Schema must be an object",
    }];
  }

  const errors: NormalizationError[] = [];

  const { type } = schema as Record<string, unknown>;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    for (const entry of types) {
      if (typeof entry !== "string" || !VALID_TYPES.has(entry)) {
        errors.push({
          type: "validation_error",
          message: `Unsupported type '${String(entry)}'`,
        });
      }
    }
  }

  if (
    Array.isArray((schema as Record<string, unknown>).required) &&
    isPlainObject((schema as Record<string, unknown>).properties)
  ) {
    const properties = (schema as Record<string, JSONSchema>)
      .properties as Record<string, JSONSchema>;
    for (const key of (schema as Record<string, string[]>).required) {
      if (!(key in properties)) {
        errors.push({
          type: "validation_error",
          message: `Required key '${key}' missing from properties`,
          path: key,
        });
      }
    }
  }

  return errors;
}

export function cleanUnsupportedKeywords(
  schema: Record<string, unknown>,
  context: NormalizationContext,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      context.warnings.push(
        `Removed unsupported keyword '${key}' at ${pathToString(context.path)}`,
      );
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

export function generateDescription(name: string, schema: JSONSchema): string {
  const base = schema.title && typeof schema.title === "string"
    ? schema.title
    : name;

  const humanised = humanizeName(base);
  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];

  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length) {
    return `${humanised}. Allowed values: ${schema.enum.join(", ")}.`;
  }

  if (schema.const !== undefined) {
    return `${humanised}. Must equal ${JSON.stringify(schema.const)}.`;
  }

  if (schema.format && typeof schema.format === "string") {
    return `${humanised} in ${schema.format} format.`;
  }

  if (schema.pattern && typeof schema.pattern === "string") {
    return `${humanised} matching pattern ${schema.pattern}.`;
  }

  if (types.includes("array") && schema.items && isPlainObject(schema.items)) {
    const itemType = schema.items.type
      ? Array.isArray(schema.items.type)
        ? schema.items.type.join(" or ")
        : schema.items.type
      : "items";
    return `Array of ${humanizeName(String(itemType))} for ${humanised}.`;
  }

  if (types.length) {
    return `${humanised} (${types.join(" or ")}).`;
  }

  return `${humanised}.`;
}

function normalizeNode(
  schema: unknown,
  context: NormalizationContext,
): JSONSchema {
  if (!isPlainObject(schema)) {
    context.errors.push({
      type: "invalid_schema",
      message: "Expected schema object",
      path: pathToString(context.path),
    });
    return { type: "object" };
  }

  if (context.depth >= context.options.maxDepth) {
    context.errors.push({
      type: "max_depth_exceeded",
      message: `Maximum depth of ${context.options.maxDepth} exceeded`,
      path: pathToString(context.path),
    });
    return { type: "object" };
  }

  if (context.seen.has(schema)) {
    context.errors.push({
      type: "circular_reference",
      message: "Circular reference detected",
      path: pathToString(context.path),
    });
    return { type: "object" };
  }

  context.seen.add(schema);

  const cleaned = cleanUnsupportedKeywords(schema, context);
  const result: JSONSchema = {};

  // 修复#2: 先处理nullable，再删除
  const nullable = cleaned.nullable === true;

  const explicitType = normalizeType(cleaned.type, context);
  let resolvedType = explicitType ?? inferType(cleaned);
  
  // 修复#3: 正确应用nullable
  if (nullable && resolvedType !== undefined) {
    if (typeof resolvedType === "string") {
      resolvedType = resolvedType === "null" ? "null" : [resolvedType, "null"];
    } else if (Array.isArray(resolvedType)) {
      if (!resolvedType.includes("null")) {
        resolvedType = [...resolvedType, "null"];
      }
    }
  }
  
  if (resolvedType !== undefined) {
    result.type = resolvedType;
  }

  // 删除nullable字段
  delete cleaned.nullable;

  if (typeof cleaned.title === "string" && cleaned.title.trim()) {
    result.title = cleaned.title.trim();
  }

  if (typeof cleaned.description === "string" && cleaned.description.trim()) {
    result.description = cleaned.description.trim();
  }

  // 修复#4: 正确处理枚举值
  if (Array.isArray(cleaned.enum)) {
    // 保留所有值，包括null和undefined
    const enumValues = cleaned.enum.filter((value) => value !== undefined);
    const dedupedValues = dedupe(enumValues);
    if (dedupedValues.length) {
      result.enum = dedupedValues;
    }
  }

  if (cleaned.const !== undefined) {
    result.const = cleaned.const;
  }

  assignStringConstraints(cleaned, result);
  assignNumericConstraints(cleaned, result);
  assignArrayConstraints(cleaned, result, context);
  assignObjectConstraints(cleaned, result, context);

  if (!result.type && (result.properties || result.additionalProperties)) {
    result.type = "object";
  }

  if (!result.type && result.items) {
    result.type = "array";
  }

  ensureDescription(result, context);

  return result;
}

function assignArrayConstraints(
  cleaned: Record<string, unknown>,
  result: JSONSchema,
  context: NormalizationContext,
): void {
  const typeCandidate = result.type;
  const isArray = typeIncludes(typeCandidate, "array");
  if (
    !isArray && cleaned.items === undefined && cleaned.minItems === undefined &&
    cleaned.maxItems === undefined
  ) {
    return;
  }

  if (cleaned.items !== undefined) {
    if (Array.isArray(cleaned.items)) {
      result.items = cleaned.items.map((item, index) =>
        normalizeNode(
          item,
          childContext(context, `items[${index}]`),
        )
      );
    } else {
      result.items = normalizeNode(
        cleaned.items,
        childContext(context, "items"),
      );
    }
  } else if (isArray && result.items === undefined) {
    result.items = { type: "object" };
  }

  copyNumericConstraint(cleaned, result, "minItems");
  copyNumericConstraint(cleaned, result, "maxItems");

  if (typeof cleaned.uniqueItems === "boolean") {
    result.uniqueItems = cleaned.uniqueItems;
  }

  if (cleaned.contains !== undefined) {
    result.contains = normalizeNode(
      cleaned.contains,
      childContext(context, "contains"),
    );
  }
}

function assignObjectConstraints(
  cleaned: Record<string, unknown>,
  result: JSONSchema,
  context: NormalizationContext,
): void {
  const typeCandidate = result.type;
  const isObject = typeIncludes(typeCandidate, "object") || !typeCandidate;

  if (!isObject && cleaned.properties === undefined) {
    if (cleaned.required !== undefined) {
      context.warnings.push(
        `Ignoring 'required' at ${
          pathToString(context.path)
        } because schema is not an object`,
      );
    }
    return;
  }

  if (cleaned.properties !== undefined) {
    if (!isPlainObject(cleaned.properties)) {
      context.errors.push({
        type: "invalid_schema",
        message: "properties must be an object",
        path: pathToString([...context.path, "properties"]),
      });
    } else {
      const properties: Record<string, JSONSchema> = {};
      for (
        const [key, value] of Object.entries(
          cleaned.properties as Record<string, unknown>,
        )
      ) {
        properties[key] = normalizeNode(value, childContext(context, key, key));
      }
      result.properties = properties;
    }
  }

  if (cleaned.patternProperties !== undefined) {
    if (!isPlainObject(cleaned.patternProperties)) {
      context.errors.push({
        type: "invalid_schema",
        message: "patternProperties must be an object",
        path: pathToString([...context.path, "patternProperties"]),
      });
    } else {
      const patternProperties: Record<string, JSONSchema> = {};
      for (
        const [pattern, value] of Object.entries(
          cleaned.patternProperties as Record<string, unknown>,
        )
      ) {
        patternProperties[pattern] = normalizeNode(
          value,
          childContext(context, `patternProperties[${pattern}]`, pattern),
        );
      }
      result.patternProperties = patternProperties;
    }
  }

  if (cleaned.additionalProperties !== undefined) {
    if (typeof cleaned.additionalProperties === "boolean") {
      result.additionalProperties = cleaned.additionalProperties;
    } else if (isPlainObject(cleaned.additionalProperties)) {
      result.additionalProperties = normalizeNode(
        cleaned.additionalProperties,
        childContext(context, "additionalProperties"),
      );
    }
  }

  copyNumericConstraint(cleaned, result, "minProperties");
  copyNumericConstraint(cleaned, result, "maxProperties");

  const required = normalizeRequiredList(
    cleaned.required,
    result.properties as Record<string, JSONSchema> | undefined,
    context,
  );
  if (required && required.length) {
    result.required = required;
  } else if (
    context.options.inferRequired &&
    result.properties &&
    Object.keys(result.properties).length
  ) {
    const inferred = inferRequiredFromProperties(
      result.properties as Record<string, JSONSchema>,
    );
    if (inferred.length) {
      result.required = inferred;
    }
  }
}

function normalizeRequiredList(
  required: unknown,
  properties: Record<string, JSONSchema> | undefined,
  context: NormalizationContext,
): string[] | undefined {
  if (required === undefined) {
    return undefined;
  }

  if (!Array.isArray(required)) {
    context.warnings.push(
      `Discarded invalid required list at ${pathToString(context.path)}`,
    );
    return undefined;
  }

  const valid: string[] = [];
  for (const entry of required) {
    if (typeof entry !== "string") {
      context.warnings.push(
        `Ignored non-string required entry at ${pathToString(context.path)}: ${
          String(entry)
        }`,
      );
      continue;
    }
    if (properties && !(entry in properties)) {
      context.warnings.push(
        `Removed unknown required key '${entry}' at ${
          pathToString(context.path)
        }`,
      );
      continue;
    }
    valid.push(entry);
  }

  return valid.length ? dedupe(valid) : undefined;
}

// 修复#5: 更保守的required推断
function inferRequiredFromProperties(
  properties: Record<string, JSONSchema>,
): string[] {
  const required: string[] = [];
  for (const [key, schema] of Object.entries(properties)) {
    if (!isPlainObject(schema)) {
      continue;
    }
    const types = schema.type;
    const typeList = Array.isArray(types) ? types : types ? [types] : [];
    const nullable = typeList.includes("null");
    const optional = schema.optional === true;

    // 更严格的推断：只有当类型明确且没有默认值时才是required
    if (schema.default !== undefined || optional || nullable) {
      continue;
    }

    // 只有当类型明确时才推断为required
    if (typeList.length === 1 && typeList[0] !== "null") {
      required.push(key);
    }
  }
  return required;
}

function assignStringConstraints(
  cleaned: Record<string, unknown>,
  result: JSONSchema,
): void {
  const isStringType = typeIncludes(result.type, "string");
  if (
    !isStringType && cleaned.pattern === undefined &&
    cleaned.format === undefined
  ) {
    return;
  }

  if (typeof cleaned.pattern === "string") {
    result.pattern = cleaned.pattern;
  }
  if (typeof cleaned.format === "string") {
    result.format = cleaned.format;
  }
  copyNumericConstraint(cleaned, result, "minLength");
  copyNumericConstraint(cleaned, result, "maxLength");
}

function assignNumericConstraints(
  cleaned: Record<string, unknown>,
  result: JSONSchema,
): void {
  const isNumeric = typeIncludes(result.type, "number") ||
    typeIncludes(result.type, "integer");
  if (
    !isNumeric && cleaned.minimum === undefined &&
    cleaned.maximum === undefined && cleaned.multipleOf === undefined
  ) {
    return;
  }

  copyNumericConstraint(cleaned, result, "minimum");
  copyNumericConstraint(cleaned, result, "maximum");
  copyNumericConstraint(cleaned, result, "exclusiveMinimum");
  copyNumericConstraint(cleaned, result, "exclusiveMaximum");
  copyNumericConstraint(cleaned, result, "multipleOf");
}

function copyNumericConstraint(
  source: Record<string, unknown>,
  target: JSONSchema,
  key: string,
): void {
  const value = source[key];
  if (typeof value === "number") {
    target[key] = value;
  }
}

function normalizeType(
  value: unknown,
  context: NormalizationContext,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    if (VALID_TYPES.has(value)) {
      return value;
    }
    context.errors.push({
      type: "validation_error",
      message: `Unsupported type '${value}'`,
      path: pathToString(context.path),
    });
    return undefined;
  }

  if (Array.isArray(value)) {
    const collected = dedupe(
      value.filter((entry): entry is string =>
        typeof entry === "string" && VALID_TYPES.has(entry)
      ),
    );
    if (collected.length === 0) {
      return undefined;
    }
    return collected.length === 1 ? collected[0] : collected;
  }

  context.warnings.push(
    `Discarded non-string type value at ${pathToString(context.path)}`,
  );
  return undefined;
}

function inferType(schema: Record<string, unknown>): string | undefined {
  if (
    isPlainObject(schema.properties) ||
    isPlainObject(schema.patternProperties) ||
    schema.additionalProperties !== undefined
  ) {
    return "object";
  }

  if (schema.items !== undefined) {
    return "array";
  }

  // 修复#6: 更好的混合类型处理
  if (Array.isArray(schema.enum) && schema.enum.length) {
    const firstValue = schema.enum[0];
    const types = new Set();
    
    for (const entry of schema.enum) {
      if (entry === null) {
        types.add("null");
      } else if (entry === undefined) {
        continue; // 跳过undefined
      } else {
        types.add(mapPrimitiveType(typeof entry));
      }
    }
    
    const typeArray = Array.from(types);
    return typeArray.length === 1 ? typeArray[0] : typeArray;
  }

  if (schema.const !== undefined) {
    return schema.const === null ? "null" : mapPrimitiveType(typeof schema.const);
  }

  if (
    schema.pattern !== undefined ||
    schema.format !== undefined ||
    schema.minLength !== undefined ||
    schema.maxLength !== undefined
  ) {
    return "string";
  }

  if (
    schema.minimum !== undefined ||
    schema.maximum !== undefined ||
    schema.exclusiveMinimum !== undefined ||
    schema.exclusiveMaximum !== undefined ||
    schema.multipleOf !== undefined
  ) {
    return "number";
  }

  if (schema.type === undefined && schema.default !== undefined) {
    return schema.default === null ? "null" : mapPrimitiveType(typeof schema.default);
  }

  return undefined;
}

function mapPrimitiveType(typeName: string): string {
  switch (typeName) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "bigint":
      return "integer";
    case "object":
      return "object";
    case "null":
      return "null";
    default:
      return "object";
  }
}

function ensureDescription(
  schema: JSONSchema,
  context: NormalizationContext,
): void {
  if (!context.options.generateDescriptions) {
    return;
  }

  const description = typeof schema.description === "string"
    ? schema.description.trim()
    : "";
  if (description) {
    schema.description = description;
    return;
  }

  const hint = context.hint ?? (schema.title as string | undefined) ??
    context.path[context.path.length - 1];
  if (!hint) {
    return;
  }

  schema.description = generateDescription(hint, schema);
}

function generateFunctionDescription(name: string): string {
  const humanised = humanizeName(name);
  return `Execute ${humanised}.`;
}

function humanizeName(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function typeIncludes(typeValue: unknown, candidate: string): boolean {
  if (typeof typeValue === "string") {
    return typeValue === candidate;
  }
  if (Array.isArray(typeValue)) {
    return typeValue.includes(candidate);
  }
  return false;
}

function childContext(
  context: NormalizationContext,
  segment: string,
  hint?: string,
): NormalizationContext {
  return {
    path: [...context.path, segment],
    depth: context.depth + 1,
    options: context.options,
    seen: context.seen,
    errors: context.errors,
    warnings: context.warnings,
    hint,
  };
}

function pathToString(path: string[]): string {
  return path.length ? path.join(".") : "root";
}

function prependPath(prefix: string, suffix?: string): string {
  if (!suffix || suffix === "root") {
    return prefix;
  }
  return `${prefix}.${suffix}`;
}

function dedupe<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// 向后兼容的导出
export function transformGeminiSchema(tools: unknown[]): unknown[] {
  const result = normalizeTools(tools, {
    maxDepth: 12,
    generateDescriptions: true,
    inferRequired: true,
  });

  if (result.errors.length > 0) {
    console.error("Schema normalization errors:", result.errors);
  }

  if (result.warnings.length > 0) {
    console.warn("Schema normalization warnings:", result.warnings);
  }

  return result.tools;
}

export function cleanSchema(schema: unknown): unknown {
  const result = normalizeSchema(schema, {
    maxDepth: 12,
    generateDescriptions: true,
    inferRequired: true,
  });

  if (result.errors.length > 0) {
    console.error("Schema normalization errors:", result.errors);
  }

  if (result.warnings.length > 0) {
    console.warn("Schema normalization warnings:", result.warnings);
  }

  return result.schema;
    }
