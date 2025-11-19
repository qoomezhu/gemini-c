# Gemini 3.0 Pro 代理服务器 - 最新适配版

基于 Deno Deploy 的 Gemini 3.0 代理服务器，完全适配最新模型功能。

## 🚀 新功能

### 支持模型

* ✅ **Gemini 3.0 Pro** - 最新多模态大模型（新增）
* ✅ **Gemini 2.5 Pro** - 向后兼容
* ✅ **Gemini Flash** - 快速响应模型
* ✅ **Flash Image** - 图像生成模型
* ✅ **所有工具调用** - 完整支持function calling

### 核心改进

* ✅ **Gemini 3.0适配** - 支持最新模型参数和功能
* ✅ **增强推理能力** - 优化多轮对话和复杂推理
* ✅ **更长上下文** - 支持更长的输入和输出
* ✅ **路径解码修复** - 支持包含`/`的复杂模型名
* ✅ **工具调用响应处理器** - 完整的多轮工具调用支持
* ✅ **SSE流式响应** - 正确处理text/event-stream
* ✅ **图像生成支持** - 正确处理二进制图像数据
* ✅ **Schema规范化** - 修复20+个critical级别bug
* ✅ **错误处理** - 完整的API错误传递
* ✅ **安全增强** - 请求大小限制、CORS配置

### 性能优化

* ✅ **内存管理** - WeakSet避免内存泄漏
* ✅ **请求限制** - 20MB最大请求大小（为3.0增加）
* ✅ **缓存优化** - 24小时CORS缓存
* ✅ **并发控制** - Map状态管理

## 🛠️ 部署指南

### 1.‌ Fork项目

访问 https://github.com/qoomezhu/gemini-c
点击 Fork 按钮

### 2.‌ 部署到Deno Deploy

1. 访问 https://dash.deno.com
2. 点击 "New Project"
3. 选择您的Fork仓库
4. 选择 `deno_index.ts` 作为入口文件
5. 点击 "Deploy"

### 3.‌ 使用API

```bash
# Gemini 3.0 Pro
curl -X POST https://your-deployment.deno.dev/v1beta/models/gemini-3-pro-preview:generateContent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "contents": [{
      "parts":[{
        "text": "Hello Gemini 3.0!"
      }]
    }]
  }'

# Gemini 2.5 Pro (向后兼容)
curl -X POST https://your-deployment.deno.dev/v1beta/models/gemini-2.5-pro:generateContent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "contents": [{
      "parts":[{
        "text": "Hello Gemini 2.5!"
      }]
    }]
  }'
