import { Router, type IRouter } from "express";
import { Request, Response } from "express";
import * as fs from "fs";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const CLAUDE_API_URL = "https://codevyx.free.nf/lego/Claude-Sonnet-4.5.php";

interface ModelConfig {
  key?: string;
  model?: string;
  temp?: number;
  top_p?: number;
  max_tokens?: number;
  name: string;
  provider: "nvidia" | "claude";
}

const AI_MODELS: Record<string, ModelConfig> = {
  chat: {
    provider: "nvidia",
    key: NVIDIA_API_KEY,
    model: "openai/gpt-oss-20b",
    temp: 1.0,
    top_p: 1.0,
    max_tokens: 4096,
    name: "GPT-OSS 20B",
  },
  console: {
    provider: "nvidia",
    key: NVIDIA_API_KEY,
    model: "qwen/qwen3.5-397b-a17b",
    temp: 0.6,
    top_p: 0.95,
    max_tokens: 4096,
    name: "Qwen 3.5 397B",
  },
  claude: {
    provider: "claude",
    name: "Claude Sonnet 4.5",
  },
};

const SYSTEM_PROMPT = `You are a helpful AI assistant specialized in SERVER HUB â€” a professional server management platform.
You have expertise in server administration, Linux, Python, Node.js, PHP, Docker, and programming in general.
Provide clear, concise, and accurate responses. Format code blocks with proper markdown syntax.`;

router.post("/ai/chat", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, model: modelKey, history = [], stream: doStream } = req.body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message required" });
      return;
    }

    const modelConfig = AI_MODELS[modelKey] || AI_MODELS.chat;

    if (modelConfig.provider === "claude") {
      const url = `${CLAUDE_API_URL}?text=${encodeURIComponent(message)}`;
      const claudeRes = await fetch(url);
      if (!claudeRes.ok) {
        res.status(502).json({ error: "Claude service error", content: "", model: modelConfig.name });
        return;
      }
      const content = await claudeRes.text();
      res.json({ content, model: modelConfig.name });
      return;
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
    }

    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.key}`,
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages,
        temperature: modelConfig.temp,
        top_p: modelConfig.top_p,
        max_tokens: modelConfig.max_tokens,
        stream: Boolean(doStream),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, body: errText }, "AI API error");
      if (doStream) {
        res.write(`data: ${JSON.stringify({ error: "AI service error" })}\n\n`);
        res.end();
      } else {
        res.status(502).json({ error: "AI service error", content: "", model: modelConfig.name });
      }
      return;
    }

    if (doStream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              res.write(`data: [DONE]\n\n`);
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || "";
              if (delta) {
                fullContent += delta;
                res.write(
                  `data: ${JSON.stringify({ delta, content: fullContent, model: modelConfig.name })}\n\n`
                );
              }
            } catch {
              // skip malformed chunk
            }
          }
        }
      }
      res.end();
    } else {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content || "";
      res.json({ content, model: modelConfig.name });
    }
  } catch (err) {
    logger.error({ err }, "Failed to call AI");
    res.status(500).json({ error: "Internal error", content: "", model: "unknown" });
  }
});

router.post("/ai/analyze", async (req: Request, res: Response): Promise<void> => {
  try {
    const { path: filePath, question } = req.body;

    if (!filePath || !question) {
      res.status(400).json({ error: "Path and question required" });
      return;
    }

    let fileContent = "";
    try {
      fileContent = fs.readFileSync(filePath, "utf8").slice(0, 8000);
    } catch {
      res.status(404).json({ error: "File not found or unreadable" });
      return;
    }

    const modelConfig = AI_MODELS.chat;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze this file (${filePath}):\n\n\`\`\`\n${fileContent}\n\`\`\`\n\n${question}`,
      },
    ];

    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.key}`,
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages,
        temperature: modelConfig.temp,
        top_p: modelConfig.top_p,
        max_tokens: modelConfig.max_tokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      res.status(502).json({ error: "AI service error", content: "", model: modelConfig.name });
      return;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content || "";
    res.json({ content, model: modelConfig.name });
  } catch (err) {
    logger.error({ err }, "Failed to analyze file");
    res.status(500).json({ error: "Internal error", content: "", model: "unknown" });
  }
});

export default router;
