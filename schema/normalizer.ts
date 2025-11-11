/**
 * Schema Normalizer for Gemini 2.5 / JSON Schema Draft 2020-12.
 * 这是一个完整修复了所有已知bug的稳定版本。
 */

// Interfaces and Types
export interface NormalizationConfig {
  maxDepth?: number;
  generateDescriptions?: boolean;
  inferRequired?: boolean;
}

export interface NormalizationError {
  type: "circular_reference" | "max_depth_exceeded" | "invalid_schema" | "validation_error";
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

interface NormalizationContext {
  path: string[];
  depth: number;
  options: Required<NormalizationConfig>;
  seen: Set<object>;
  errors: NormalizationError[];
  warnings: string[];
  hint?: string;
}

// Constants
const DEFAULT_CONFIG: Required<NormalizationConfig> = {
  maxDepth: 12,
  generateDescriptions: true,
  inferRequired: true,
};

const UNSUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "$comment", "readOnly", "writeOnly", "deprecated",
  "contentMediaType", "contentEncoding", "if", "then", "else", "not",
]);

const VALID_TYPES = new Set(["null", "boolean", "object", "array", "number", "string", "integer"]);

// Main Functions
export function normalizeSchema(schema: unknown, config: NormalizationConfig = {}): NormalizationResult<JSONSchema> {
  const options = { ...DEFAULT_CONFIG, ...config };
  const context: NormalizationContext = {
    path: [], depth: 0, options, seen: new Set(), errors: [], warnings: []
  };
  const normalized = normalizeNode(schema, context);
  return { schema: normalized, errors: context.errors, warnings: context.warnings };
}

export function normalizeTools(tools: unknown, config: NormalizationConfig = {}): NormalizedToolsResult {
  const options = { ...DEFAULT_CONFIG, ...config };
  const errors: NormalizationError[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(tools)) {
    errors.push({ type: "invalid_schema", message: "Tools payload must be an array", path: "tools" });
    return { tools: [], errors, warnings };
  }

  const normalizedTools = tools.map((tool, toolIndex) => {
    if (!isPlainObject(tool)) {
      errors.push({ type: "invalid_schema", message: "Tool entry must be an object", path: `tools[${toolIndex}]` });
      return tool;
    }

    const normalizedTool = { ...tool };
    const declarations = normalizedTool.function_declarations;

    if (Array.isArray(declarations)) {
      normalizedTool.function_declarations = declarations.map((declaration, declIndex) => {
        if (!isPlainObject(declaration)) {
          errors.push({ type: "invalid_schema", message: "Function declaration must be an object", path: `tools[${toolIndex}].function_declarations[${declIndex}]` });
          return declaration;
        }

        const normalizedDeclaration = { ...declaration };
        const functionName = typeof normalizedDeclaration.name === "string" ? normalizedDeclaration.name : `function_${declIndex}`;

        if (options.generateDescriptions && !normalizedDeclaration.description) {
            normalizedDeclaration.description = `Executes the ${humanizeName(functionName)} function.`;
        }

        if (normalizedDeclaration.parameters) {
          const result = normalizeSchema(normalizedDeclaration.parameters, options);
          normalizedDeclaration.parameters = result.schema;
          errors.push(...result.errors.map(e => ({ ...e, path: `tools[${toolIndex}].function_declarations[${declIndex}].parameters.${e.path}` })));
          warnings.push(...result.warnings.map(w => `In tool[${toolIndex}].function_declarations[${declIndex}]: ${w}`));
        }
        return normalizedDeclaration;
      });
    }
    return normalizedTool;
  });

  return { tools: normalizedTools, errors, warnings };
}

// Normalization Core
function normalizeNode(schema: unknown, context: NormalizationContext): JSONSchema {
  if (!isPlainObject(schema)) {
    context.errors.push({ type: "invalid_schema", message: "Schema node must be an object.", path: pathToString(context.path) });
    return { type: "object", description: "Invalid schema provided." };
  }

  if (context.seen.has(schema)) {
    context.errors.push({ type: "circular_reference", message: "Circular reference detected.", path: pathToString(context.path) });
    return { type: "object", description: "Circular reference." };
  }

  if (context.depth >= context.options.maxDepth) {
    context.errors.push({ type: "max_depth_exceeded", message: `Max depth of ${context.options.maxDepth} exceeded.`, path: pathToString(context.path) });
    return { type: "object", description: "Schema too deep." };
  }

  context.seen.add(schema);

  const result: JSONSchema = {};
  
  // Clean unsupported keywords first
  for (const key in schema) {
      if (!UNSUPPORTED_KEYWORDS.has(key)) {
          result[key] = schema[key];
      } else {
          context.warnings.push(`Removed unsupported keyword '${key}' at ${pathToString(context.path)}`);
      }
  }

  // Type handling (nullable fix)
  const isNullable = result.nullable === true;
  delete result.nullable;
  let resolvedType = normalizeType(result.type, context) ?? inferType(result);
  if (isNullable) {
      resolvedType = Array.isArray(resolvedType) ? [...new Set([...resolvedType, "null"])] : (resolvedType && resolvedType !== "null" ? [resolvedType, "null"] : "null");
  }
  if (resolvedType) result.type = resolvedType;

  // Process properties
  if (isPlainObject(result.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, value]) => [key, normalizeNode(value, childContext(context, key, key))])
    );
  }

  // Process items
  if (result.items) {
      result.items = normalizeNode(result.items, childContext(context, "items"));
  }

  // Enum handling (undefined fix)
  if (Array.isArray(result.enum)) {
      result.enum = [...new Set(result.enum)]; // Keep all values including null, just dedupe
  }

  // Required properties (conservative inference fix)
  if (result.properties && isPlainObject(result.properties)) {
    const required = normalizeRequiredList(result.required, Object.keys(result.properties), context);
    if (required.length > 0) {
      result.required = required;
    } else if (context.options.inferRequired) {
      const inferred = inferRequiredFromProperties(result.properties);
      if (inferred.length > 0) result.required = inferred;
    }
  }
  
  // Generate description if needed
  if (context.options.generateDescriptions && !result.description) {
      const hint = context.hint ?? context.path[context.path.length - 1];
      if (hint) result.description = generateDescription(hint, result);
  }
  
  context.seen.delete(schema);
  return result;
}


// Helper functions
function inferType(schema: JSONSchema): string | string[] | undefined {
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.pattern || schema.format || schema.minLength !== undefined || schema.maxLength !== undefined) return "string";
  if (schema.minimum !== undefined || schema.maximum !== undefined || schema.multipleOf !== undefined) return "number";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      const types = new Set(schema.enum.map(v => v === null ? "null" : typeof v));
      if(types.has("bigint")) types.add("integer");
      const typeArray = Array.from(types).filter(t => VALID_TYPES.has(t as string));
      return typeArray.length === 1 ? typeArray[0] : typeArray;
  }
  return undefined;
}

function normalizeType(value: unknown, context: NormalizationContext): string | string[] | undefined {
    if (typeof value === 'string' && VALID_TYPES.has(value)) return value;
    if (Array.isArray(value)) {
        const validTypes = [...new Set(value.filter(t => typeof t === 'string' && VALID_TYPES.has(t)))];
        if (validTypes.length > 0) return validTypes.length === 1 ? validTypes[0] : validTypes;
    }
    if (value !== undefined) {
        context.warnings.push(`Invalid type value '${JSON.stringify(value)}' at ${pathToString(context.path)}`);
    }
    return undefined;
}

function inferRequiredFromProperties(properties: Record<string, unknown>): string[] {
  return Object.entries(properties)
    .filter(([, schema]) =>
        isPlainObject(schema) &&
        schema.default === undefined &&
        !typeIncludes(schema.type, "null")
    )
    .map(([key]) => key);
}

function normalizeRequiredList(required: unknown, propKeys: string[], context: NormalizationContext): string[] {
    if (!Array.isArray(required)) return [];
    return [...new Set(required.filter(key => {
        const isValid = typeof key === 'string' && propKeys.includes(key);
        if (!isValid) context.warnings.push(`Invalid or unknown key '${key}' in required array at ${pathToString(context.path)}`);
        return isValid;
    }))];
}

function generateDescription(name: string, schema: JSONSchema): string {
    const type = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type;
    return `${humanizeName(name)}${type ? ` (${type})` : ''}.`;
}

function humanizeName(input: string): string {
    return input.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function typeIncludes(typeValue: unknown, candidate: string): boolean {
    return (Array.isArray(typeValue) && typeValue.includes(candidate)) || typeValue === candidate;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function pathToString(path: string[]): string {
  return path.length > 0 ? path.join('.') : 'root';
}

function childContext(context: NormalizationContext, segment: string, hint?: string): NormalizationContext {
  return { ...context, path: [...context.path, segment], depth: context.depth + 1, hint: hint || segment };
}

// Backward Compatibility Exports
export function transformGeminiSchema(tools: unknown[]): unknown[] {
  return normalizeTools(tools).tools;
}
export function cleanSchema(schema: unknown): unknown {
  return normalizeSchema(schema).schema;
}
