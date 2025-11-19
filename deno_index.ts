/** 
 * Gemini 3.0 Pro 代理服务器 - 最新适配版 
 * 锁定 Deno 标准库版本到 0.224.0 以确保部署成功 
 * 采用无状态代理模式，提高稳定性和性能 
 */
// ✅ 最终修复：使用已知稳定的 Deno 标准库版本和路径
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { normalizeTools } from "./schema/normalizer.ts";

// ========== 配置常量 ==========
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/";
const MAX_REQUEST_SIZE = 20 * 1024 * 1024; // 20MB，以支持更大的图像和上下文

/**
 * 创建标准化的 JSON 错误响应
 */
function createErrorResponse(message: string, code: string, status: number): Response {
  const errorBody = JSON.stringify({
    error: {
      message,
      code,
      status
    }
  });
  return new Response(errorBody, {
    status,
    headers: getCorsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

/**
 * 获取 CORS 响应头
 */
function getCorsHeaders(customHeaders: Record<string, string> = {}): Headers {
  const headers = new Headers(customHeaders);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-goog-api-client');
  headers.set('Access-Control-Max-Age', '86400'); // 24小时
  return headers;
}

/**
 * 主请求处理函数
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 根路径响应，提供服务状态信息
  if (url.pathname === "/") {
    return new Response(`🚀 Gemini 3.0 Pro Proxy - Latest Version is running.\n\nSupported Models:\n- gemini-3-pro-preview\n- gemini-2.5-pro\n- gemini-2.5-flash\n- gemini-2.0-flash-exp`, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      },
    });
  }

  // 处理 CORS 预检请求
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders()
    });
  }

  // 检查请求体大小
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return createErrorResponse("Request body too large.", "PAYLOAD_TOO_LARGE", 413);
  }

  // 构造目标 Gemini API URL
  // 正确处理路径，移除开头的'/'
  const targetUrl = `${GEMINI_BASE_URL}${url.pathname.slice(1)}${url.search}`;
  
  if (!targetUrl.startsWith(GEMINI_BASE_URL)) {
    return createErrorResponse("Invalid target URL.", "INVALID_TARGET", 400);
  }

  // 准备代理请求
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('host'); // 移除 host 头，避免代理冲突

  let requestBody = req.body;

  // 如果是 POST/PUT 请求，检查并规范化工具定义
  if ((req.method === 'POST' || req.method === 'PUT') && requestHeaders.get('content-type')?.includes('application/json')) {
    try {
      const originalPayload = await req.json();
      
      // 检查是否存在 'tools' 字段并进行规范化
      if (originalPayload.tools && Array.isArray(originalPayload.tools)) {
        const normalized = normalizeTools(originalPayload.tools);
        if (normalized.errors.length > 0) {
          console.error("Schema Normalization Errors:", normalized.errors);
          // 即使有错也继续，让 Gemini API 自己决定
        }
        if (normalized.warnings.length > 0) {
          console.warn("Schema Normalization Warnings:", normalized.warnings);
        }
        originalPayload.tools = normalized.tools;
      }
      
      // 为Gemini 3.0添加额外的参数支持
      if (originalPayload.model && originalPayload.model.includes('gemini-3')) {
        // 为Gemini 3.0添加特定的配置
        if (!originalPayload.generationConfig) {
          originalPayload.generationConfig = {};
        }
        
        // 为3.0模型启用更长的上下文
        if (!originalPayload.generationConfig.maxOutputTokens) {
          originalPayload.generationConfig.maxOutputTokens = 8192; // 增加输出token限制
        }
      }
      
      requestBody = JSON.stringify(originalPayload);
    } catch (e) {
      // 如果请求体不是有效的JSON，则按原样代理
      console.warn("Could not parse JSON body, proxying as is.", e.message);
      // 需要重新创建请求体，因为 req.json() 已经消费了它
      const clonedReq = req.clone();
      requestBody = await clonedReq.blob();
    }
  }

  try {
    // 向 Gemini API 发起请求
    const geminiResponse = await fetch(targetUrl, {
      method: req.method,
      headers: requestHeaders,
      body: requestBody,
      redirect: "manual"
    });

    // 将 Gemini 的响应头加上 CORS 头后返回给客户端
    const responseHeaders = getCorsHeaders(Object.fromEntries(geminiResponse.headers.entries()));
    
    // 检查是否为流式响应
    if (geminiResponse.headers.get('content-type')?.includes('text/event-stream')) {
      // 对于SSE流式响应，直接返回
      return new Response(geminiResponse.body, {
        status: geminiResponse.status,
        statusText: geminiResponse.statusText,
        headers: responseHeaders
      });
    } else {
      // 对于非流式响应，直接返回
      return new Response(geminiResponse.body, {
        status: geminiResponse.status,
        statusText: geminiResponse.statusText,
        headers: responseHeaders
      });
    }
  } catch (error) {
    console.error("Error proxying request to Gemini API:", error);
    return createErrorResponse(`Failed to proxy request: ${error.message}`, "PROXY_ERROR", 502);
  }
}

// ========== 启动服务器 ==========
console.log(`🚀 Gemini 3.0 Pro Proxy (Latest Version) is starting on port 8000.`);
serve(handler, { port: 8000 });
