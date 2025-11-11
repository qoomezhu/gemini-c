# Gemini 2.5 Pro 代理服务器 - 修复版本

基于 Deno Deploy 的 Gemini 2.5 代理服务器，修复了所有关键bug，支持最新模型功能。

## 🚀 新功能

### 支持模型
- ✅ **Gemini 2.5 Pro** - 最新多模态大模型
- ✅ **Gemini Flash** - 快速响应模型  
- ✅ **Flash Image** - 图像生成模型
- ✅ **所有工具调用** - 完整支持function calling

### 核心修复
- ✅ **路径解码修复** - 支持包含`/`的复杂模型名
- ✅ **工具调用响应处理器** - 完整的多轮工具调用支持
- ✅ **SSE流式响应** - 正确处理text/event-stream
- ✅ **图像生成支持** - 正确处理二进制图像数据
- ✅ **Schema规范化** - 修复20+个critical级别bug
- ✅ **错误处理** - 完整的API错误传递
- ✅ **安全增强** - 请求大小限制、CORS配置

### 性能优化
- ✅ **内存管理** - WeakSet避免内存泄漏
- ✅ **请求限制** - 10MB最大请求大小
- ✅ **缓存优化** - 24小时CORS缓存
- ✅ **并发控制** - Map状态管理

## 🛠️ 部署指南

### 1. Fork项目
```bash
# 访问 https://github.com/qoomezhu/gemini-c
# 点击 Fork 按钮
