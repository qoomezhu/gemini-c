/**
 * Gemini 2.5 Pro代理服务器 - 修复版本
 * 支持：工具调用、流式响应、图像生成、错误处理
 */
// 将导入语句改为新的路径
import { serve } from "https://deno.land/std@0.225.0/http/mod.ts"; 
// 或者为了兼容性使用最新稳定版本
// import { serve } from "https://deno.land/std/http/mod.ts"; 
import { normalizeSchema, normalizeTools } from "./schema/normalizer.ts";

// ========== 配置常量 ==========
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/";
const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB
const CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:8080", 
  "https://localhost:3000",
  "https://localhost:8080",
  // 添加你的域名到这里
];

// ========== 工具调用响应处理器 ==========
class ToolCallProcessor {
  private pendingCalls: Map<string, any> = new Map();

  constructor() {
    // 设置全局处理器
    globalThis.ToolCallProcessor = this;
  }

  async handleToolCall(request: Request, apiKey: string): Promise<Response> {
    const requestData = await request.clone().json();
    
    if (requestData.tool_call_responses) {
      return this.handleToolCallResponses(requestData, apiKey);
    }
    
    if (requestData.tools) {
      return this.prepareToolCall(requestData, apiKey);
    }

    // 普通请求 - 直接代理
    return this.proxyToGemini(request, apiKey);
  }

  private async handleToolCallResponses(requestData: any, apiKey: string): Promise<Response> {
    // 查找原始的工具调用请求
    const originalCall = this.findOriginalToolCall(requestData.tool_call_responses);
    if (!originalCall) {
      return new Response(JSON.stringify({
        error: {
          message: "Tool call response received but original call not found",
          code: "TOOL_CALL_NOT_FOUND"
        }
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 将响应合并到原始请求中
    const finalRequest = this.mergeToolResponses(originalCall, requestData.tool_call_responses);
    
    return this.proxyToGemini(new Request(originalCall.url, {
      method: 'POST',
      headers: originalCall.headers,
      body: JSON.stringify(finalRequest),
    }), apiKey);
  }

  private async prepareToolCall(requestData: any, apiKey: string): Promise<Response> {
    // 规范化工具定义
    const toolsResult = normalizeTools(requestData.tools, {
      maxDepth: 12,
      generateDescriptions: true,
      inferRequired: true,
    });

    if (toolsResult.errors.length > 0) {
      console.error("Schema normalization errors:", toolsResult.errors);
    }

    if (toolsResult.warnings.length > 0) {
      console.warn("Schema normalization warnings:", toolsResult.warnings);
    }

    // 替换工具定义
    requestData.tools = toolsResult.tools;
    
    // 添加工具调用ID用于跟踪
    const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.pendingCalls.set(toolCallId, requestData);

    return this.proxyToGemini(new Request("", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Tool-Call-ID': toolCallId
      },
      body: JSON.stringify(requestData),
    }), apiKey);
  }

  private async proxyToGemini(request: Request, apiKey: string): Promise<Response> {
    try {
      // 构建目标URL - 正确处理路径编码
      const url = new URL(request.url);
      const targetPath = url.pathname; // 不进行slice(1)和decodeURIComponent
      const targetUrl = `${GEMINI_BASE_URL}${targetPath}${url.search}`;

      // 验证目标URL
      if (!targetUrl.startsWith(GEMINI_BASE_URL)) {
        return new Response(JSON.stringify({
          error: {
            message: "Invalid target URL. Must target Gemini API.",
            code: "INVALID_TARGET_URL"
          }
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 检查请求大小
      if (request.body) {
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
          return new Response(JSON.stringify({
            error: {
              message: "Request too large",
              code: "REQUEST_TOO_LARGE"
            }
          }), {
            status: 413,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      // 构建请求头
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${apiKey}`);
      headers.delete('host');
      headers.delete('origin');

      // 代理请求到Gemini
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual"
      });

      // 检查是否是图像生成响应
      const contentType = response.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        return this.handleImageResponse(response);
      }

      // 检查是否是流式响应
      if (contentType.includes('text/event-stream')) {
        return this.handleStreamResponse(response);
      }

      // 普通JSON响应
      return this.handleJsonResponse(response);

    } catch (error) {
      console.error(`Proxy error: ${error.message}`);
      return new Response(JSON.stringify({
        error: {
          message: `Proxy failed: ${error.message}`,
          code: "PROXY_ERROR"
        }
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  private async handleImageResponse(response: Response): Promise<Response> {
    // 直接返回图像数据，保持原始响应头
    const headers = new Headers(response.headers);
    this.addCorsHeaders(headers);
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  private async handleStreamResponse(response: Response): Promise<Response> {
    const headers = new Headers(response.headers);
    this.addCorsHeaders(headers);
    
    // 确保SSE流的Content-Type
    headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  private async handleJsonResponse(response: Response): Promise<Response> {
    const headers = new Headers(response.headers);
    this.addCorsHeaders(headers);

    // 尝试解析和验证JSON
    try {
      const jsonData = await response.clone().json();
      
      // 检查是否是工具调用响应
      if (jsonData.tool_calls || jsonData.candidates?.[0]?.tool_call) {
        // 流式工具调用需要特殊处理
        if (headers.get('content-type')?.includes('text/event-stream')) {
          return this.handleStreamResponse(response);
        }
      }

      // 错误信息保持原始格式
      if (!response.ok) {
        return new Response(JSON.stringify(jsonData), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      return new Response(JSON.stringify(jsonData), {
        status: response.status,
        statusText: response.statusText,
        headers
      });

    } catch (error) {
      console.error(`JSON parsing error: ${error.message}`);
      
      // 如果JSON解析失败，返回原始响应
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  }

  private addCorsHeaders(headers: Headers): void {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tool-Call-ID');
    headers.set('Access-Control-Max-Age', '86400'); // 24小时缓存
  }

  private findOriginalToolCall(toolResponses: any): any | null {
    // 从pending calls中找到匹配的工具调用
    for (const [id, call] of this.pendingCalls.entries()) {
      if (this.isMatchingToolCall(call, toolResponses)) {
        this.pendingCalls.delete(id); // 清理
        return call;
      }
    }
    return null;
  }

  private isMatchingToolCall(originalCall: any, responses: any): boolean {
    // 简单的匹配逻辑：检查工具调用ID或响应数量
    return responses.length > 0;
  }

  private mergeToolResponses(originalCall: any, responses: any): any {
    // 将工具响应合并到原始请求中
    return {
      ...originalCall,
      tool_call_responses: responses
    };
  }
}

// ========== 主请求处理器 ==========
const toolProcessor = new ToolCallProcessor();

/**
 * 主HTTP处理函数
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // 主页响应
  if (url.pathname === "/" || url.pathname === "") {
    return new Response(`
      🚀 Gemini 2.5 Pro 代理服务器
      
      ✨ 支持功能：
      - Gemini 2.5 Pro/Flash模型
      - 工具调用响应处理
      - 流式文本生成
      - Flash Image图像生成
      - 错误处理和诊断
      
      📡 API端点：${url.origin}${url.pathname}
      
      ⚠️  仅限Gemini API使用
    `, {
      status: 200,
      headers: { 
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      },
    });
  }

  // CORS预检请求
  if (req.method === "OPTIONS") {
    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tool-Call-ID');
    headers.set('Access-Control-Max-Age', '86400');
    
    return new Response(null, { status: 204, headers });
  }

  // 提取API Key
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '') ||
                req.headers.get('x-goog-api-key');

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: {
        message: "API key required",
        code: "MISSING_API_KEY"
      }
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 处理请求
  return await toolProcessor.handleToolCall(req, apiKey);
}

// ========== 启动服务器 ==========
console.log(`
🚀 Gemini 2.5 Pro 代理服务器已启动
🔗 监听端口: 8000
📡 代理目标: ${GEMINI_BASE_URL}
🔧 最大请求大小: ${MAX_REQUEST_SIZE / 1024 / 1024}MB
`);

serve(handler, { port: 8000 });
