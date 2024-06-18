const express = require('express'); // 引入 Express 框架
const axios = require('axios'); // 引入 axios 库用于 HTTP 请求
const app = express(); // 创建 Express 应用实例
const port = process.env.PORT || 3000; // 指定应用监听的端口号

app.use(express.json()); // 使用中间件解析请求体为 JSON 格式

// 处理 DUIX 平台的 POST 请求
app.post('/conversation', async (req, res) => {
    console.log("Received request headers:", req.headers); // 打印请求头信息到控制台
    console.log("Received request body:", req.body); // 打印请求体信息到控制台

    // 定义 startTime 并初始化为当前时间戳
    const startTime = Date.now();

    // 解构请求体，获取必要的字段
    const { sid, 'dh-code': dhCode, 'dh-question': dhQuestion, 'dh-conversation-id': dhConversationId, 'dh-context': dhContext } = req.body;

    // 检查必要字段是否缺失，如果缺失则返回 400 错误响应
    if (!sid || !dhCode || !dhQuestion || !dhConversationId) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // 准备发送给第三方 API 的请求数据
    const thirdPartyRequestData = {
        bot_app_key: "NmRQZMMP",
        content: dhQuestion,
        session_id: dhConversationId.toString(),
        visitor_biz_id: sid.toString()
    };

    // 设置响应头，使用 Server-Sent Events (SSE) 协议
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // 刷新响应头信息

    console.log("Request data being sent to third-party API:", thirdPartyRequestData); // 打印发送给第三方 API 的请求数据到控制台

    try {
        // 发起异步请求到第三方 API
        const responseStream = await axios({
            method: 'post',
            url: 'https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse',
            data: thirdPartyRequestData,
            responseType: 'stream', // 响应类型为流
            headers: {
                'Content-Type': 'application/json' // 请求头中的 Content-Type
            }
        });

        let buffer = ''; // 用于拼接数据块
        let chunkCount = 0; // 记录接收到的 chunk 数量
        let previousContent = ''; // 用于存储上一次已发送的内容
        let currentContent = ''; // 用于累积当前消息的内容

        // 监听第三方 API 返回的数据流的 'data' 事件
        responseStream.data.on('data', (chunk) => {
            buffer += chunk.toString(); // 将接收到的数据块拼接到 buffer 中

            let boundary = buffer.indexOf('\n\n'); // 查找数据块的分界点
            while (boundary !== -1) {
                const dataString = buffer.substring(0, boundary).trim(); // 提取一个完整的数据块
                buffer = buffer.substring(boundary + 2); // 更新 buffer，准备处理下一个数据块
                boundary = buffer.indexOf('\n\n'); // 查找下一个数据块的分界点

                console.log("Received dataString:", dataString); // 打印接收到的数据块到控制台

                const eventIndex = dataString.indexOf('event:'); // 查找事件标识
                const dataIndex = dataString.indexOf('data:'); // 查找数据部分

                // 如果同时存在事件标识和数据部分
                if (eventIndex !== -1 && dataIndex !== -1) {
                    const event = dataString.substring(eventIndex + 6, dataIndex).trim(); // 提取事件类型
                    const data = JSON.parse(dataString.substring(dataIndex + 5).trim()); // 解析数据部分为 JSON 格式

                    if (event === 'reply') { // 如果事件类型是 'reply'
                        let content = data.payload.content; // 提取响应内容
                        const isFinal = data.payload.is_final; // 是否是最终响应块

                        chunkCount += 1; // 增加接收的块计数

                        // 只处理从第二个开始的响应块
                        if (chunkCount >= 2) {
                            // 检查是否满足发送条件
                            currentContent = data.payload.content.substring(previousContent.length);
                            if (currentContent.length >= 100 && !data.payload.is_final) {
                                const punctuationMarks = ['。', '！', '\n'];
                                let lastPunctuationIndex = -1;
                                for (const mark of punctuationMarks) {
                                    const index = currentContent.lastIndexOf(mark);
                                    if (index > lastPunctuationIndex) {
                                        lastPunctuationIndex = index;
                                    }
                                }
                                let sendContent = '';
                                if (lastPunctuationIndex !== -1) {
                                    sendContent = currentContent.substring(0, lastPunctuationIndex + 1);
                                    res.write(`data: ${JSON.stringify({ answer: sendContent, isEnd: data.payload.is_final })}\n\n`);
                                }
                                previousContent += sendContent;
                            } else if (data.payload.is_final) {
                                res.write(`data: ${JSON.stringify({ answer: currentContent, isEnd: data.payload.is_final })}\n\n`);
                                previousContent = '';
                                currentContent = '';
                            } else {
                                currentContent = '';
                            }
                        }
                    }
                }
            }
        });

        // 监听响应流的 'end' 事件
        responseStream.data.on('end', () => {
            console.log("SSE stream ended"); // 打印响应流结束信息到控制台
            res.end(); // 结束响应
        });

        // 监听响应流的 'error' 事件
        responseStream.data.on('error', (error) => {
            console.error("Error in SSE response:", error); // 打印响应流错误信息到控制台
            res.status(500).json({ error: "Internal Server Error" }); // 返回 500 错误响应
        });
    } catch (error) {
        if (error.response) {
            console.error("Error response from third-party API:", error.response.data); // 打印第三方 API 返回的错误信息到控制台
            res.status(error.response.status).json(error.response.data); // 返回第三方 API 返回的错误响应
        } else if (error.request) {
            console.error("No response received from third-party API:", error.request); // 打印未接收到第三方 API 响应的信息到控制台
            res.status(500).json({ error: "No response received from third-party API" }); // 返回 500 错误响应
        } else {
            console.error("Error in setting up request:", error.message); // 打印设置请求时的错误信息到控制台
            res.status(500).json({ error: "Error in setting up request" }); // 返回 500 错误响应
        }
    }
});

// 启动 Express 服务器，监听指定的端口
app.listen(port, () => {
    console.log(`Conversation platform listening at http://localhost:${port}`); // 打印服务器启动信息到控制台
});
